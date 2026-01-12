// lib/clients/smartEmbedding.js

import { generateLocalEmbedding, isLocalEmbeddingReady } from './localEmbedding.js';
import { generateEmbedding as generateOpenAIEmbedding } from './openai.js';

/**
 * Smart embedding generation for queries
 * Uses local embeddings (fast) with optional OpenAI fallback
 * 
 * @param {string} text - Text to embed
 * @param {Object} options - Configuration options
 * @param {boolean} options.useLocal - Use local model (default: true)
 * @param {boolean} options.fallbackToOpenAI - Use OpenAI if local fails (default: false for queries)
 * @returns {Promise<number[]>} 1536-dimensional embedding
 */
export async function generateQueryEmbedding(text, options = {}) {
  const { 
    useLocal = true,
    fallbackToOpenAI = false, // Default to false for queries (user wants local only)
  } = options;
  
  const start = Date.now();
  
  // Use local embedding (preferred for queries)
  if (useLocal) {
    try {
      const embedding = await generateLocalEmbedding(text);
      
      // Validate the embedding
      if (!Array.isArray(embedding) || embedding.length !== 1536) {
        throw new Error(`Invalid embedding dimensions: ${embedding?.length}`);
      }
      
//       console.log(`[Smart Embedding] ✅ Generated via local model in ${Date.now() - start}ms`);
      return embedding;
    } catch (error) {
//       console.error('[Smart Embedding] ⚠️ Local embedding failed:', error.message);
      
      if (fallbackToOpenAI) {
//         console.log('[Smart Embedding] 🔄 Falling back to OpenAI...');
        const embedding = await generateOpenAIEmbedding(text);
//         console.log(`[Smart Embedding] ✅ Generated via OpenAI fallback in ${Date.now() - start}ms`);
        return embedding;
      }
      
      throw error;
    }
  }
  
  // Use OpenAI directly if local disabled
//   console.log('[Smart Embedding] Using OpenAI (local disabled)');
  const embedding = await generateOpenAIEmbedding(text);
//   console.log(`[Smart Embedding] ✅ Generated via OpenAI in ${Date.now() - start}ms`);
  return embedding;
}

