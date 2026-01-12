// lib/clients/localEmbedding.js

import { pipeline } from '@xenova/transformers';

let embedder = null;
let isLoading = false;
let loadPromise = null;

/**
 * Initialize the embedding model (lazy loading)
 * Model is loaded once and cached in memory
 */
async function getEmbedder() {
  if (embedder) {
    return embedder;
  }
  
  // Prevent multiple simultaneous loads
  if (isLoading) {
    return loadPromise;
  }
  
  isLoading = true;
  console.log('[Local Embedding] Loading model (first time only)...');
  
  loadPromise = (async () => {
    try {
      const start = Date.now();
      
      // Use all-MiniLM-L6-v2: fast, lightweight, good quality
      // Produces 384-dimensional embeddings
      embedder = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { 
          quantized: true, // Use quantized version for faster loading and inference
          device: 'cpu', // Explicitly set CPU (faster for small models)
        }
      );
      
      console.log(`[Local Embedding] ✅ Model loaded in ${Date.now() - start}ms`);
      isLoading = false;
      return embedder;
    } catch (error) {
      console.error('[Local Embedding] ❌ Failed to load model:', error);
      isLoading = false;
      embedder = null;
      loadPromise = null;
      throw error;
    }
  })();
  
  return loadPromise;
}

/**
 * Pad embedding to 1536 dimensions using zero-padding
 * Optimized version for better performance
 * Maintains semantic similarity while matching OpenAI dimensions
 * 
 * @param {number[]} embedding - Original embedding (384d)
 * @returns {number[]} Padded embedding (1536d)
 */
function padEmbeddingTo1536(embedding) {
  const targetDim = 1536;
  const originalDim = embedding.length;
  
  if (originalDim === targetDim) {
    return embedding;
  }
  
  if (originalDim > targetDim) {
    console.warn(`[Local Embedding] Embedding larger than target, truncating from ${originalDim} to ${targetDim}`);
    return embedding.slice(0, targetDim);
  }
  
  // Pre-allocate typed array (faster than regular array + fill)
  const padded = new Float32Array(targetDim);
  
  // Copy original values (faster with typed array)
  for (let i = 0; i < originalDim; i++) {
    padded[i] = embedding[i];
  }
  
  // Optimized normalization - calculate magnitude from original embedding only
  // (no need to calculate from padded array since rest is zeros)
  let sumSq = 0;
  for (let i = 0; i < originalDim; i++) {
    const val = embedding[i];
    sumSq += val * val;
  }
  const magnitude = Math.sqrt(sumSq);
  
  // Normalize in single pass (only normalize non-zero values)
  if (magnitude > 0) {
    const invMagnitude = 1 / magnitude; // Pre-calculate inverse (faster than division)
    for (let i = 0; i < originalDim; i++) {
      padded[i] = embedding[i] * invMagnitude;
    }
  }
  
  return Array.from(padded); // Convert back to regular array for compatibility
}

/**
 * Generate local embedding and pad to 1536 dimensions
 * This is fast (50-100ms) and doesn't require API calls
 * 
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} 1536-dimensional embedding
 */
export async function generateLocalEmbedding(text) {
  const start = Date.now();
  
  try {
    // Validate input
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid input: text must be a non-empty string');
    }
    
    // Truncate very long texts to avoid memory issues
    const maxLength = 8000; // characters
    const truncatedText = text.length > maxLength 
      ? text.substring(0, maxLength) 
      : text;
    
    if (text.length > maxLength) {
      console.warn(`[Local Embedding] Text truncated from ${text.length} to ${maxLength} characters`);
    }
    
    // Get the model
    const model = await getEmbedder();
    
    // Generate base embedding (384d)
    const output = await model(truncatedText, {
      pooling: 'mean', // Average pooling
      normalize: true,  // Normalize to unit length
    });
    
    // Convert to plain array - optimized conversion
    // Handle different output formats from transformers.js
    let baseEmbedding;
    
    // Optimized: check most common cases first
    if (output?.data) {
      // Tensor with .data property (most common case)
      baseEmbedding = output.data instanceof Function 
        ? Array.from(output.data()) 
        : Array.from(output.data);
    } else if (Array.isArray(output)) {
      // Already an array (fast path)
      baseEmbedding = output;
    } else if (output && output.length !== undefined) {
      // Array-like object
      baseEmbedding = Array.from(output);
    } else {
      // Fallback: try direct conversion
      try {
        baseEmbedding = Array.from(output);
      } catch (e) {
        console.error('[Local Embedding] Output type:', typeof output);
        console.error('[Local Embedding] Output keys:', Object.keys(output || {}));
        throw new Error(`Cannot convert embedding output to array: ${e.message}`);
      }
    }
    
    // Validate embedding
    if (!Array.isArray(baseEmbedding) || baseEmbedding.length === 0) {
      console.error('[Local Embedding] Invalid embedding:', {
        type: typeof baseEmbedding,
        length: baseEmbedding?.length,
        isArray: Array.isArray(baseEmbedding)
      });
      throw new Error(`Invalid embedding output: expected array, got ${typeof baseEmbedding}`);
    }
    
    // Validate dimension (should be 384 for all-MiniLM-L6-v2)
    if (baseEmbedding.length !== 384) {
      console.warn(`[Local Embedding] ⚠️ Unexpected embedding dimension: ${baseEmbedding.length} (expected 384)`);
    }
    
    // Pad to 1536 dimensions
    const paddedEmbedding = padEmbeddingTo1536(baseEmbedding);
    
    const elapsed = Date.now() - start;
    console.log(`[Local Embedding] ✅ Generated in ${elapsed}ms (${baseEmbedding.length}d → ${paddedEmbedding.length}d)`);
    
    return paddedEmbedding;
  } catch (error) {
    console.error('[Local Embedding] ❌ Error generating embedding:', error.message);
    throw error;
  }
}

/**
 * Warmup function - call this on server startup
 * Loads the model and generates a test embedding
 * This prevents the first user query from being slow
 */
export async function warmupLocalEmbedding() {
  try {
    console.log('[Local Embedding] 🔥 Warming up model...');
    const start = Date.now();
    
    await generateLocalEmbedding('warmup test query for model initialization');
    
    console.log(`[Local Embedding] ✅ Warmup complete in ${Date.now() - start}ms`);
    return true;
  } catch (error) {
    console.error('[Local Embedding] ❌ Warmup failed:', error.message);
    return false;
  }
}

/**
 * Check if the local embedding model is ready
 */
export function isLocalEmbeddingReady() {
  return embedder !== null;
}

