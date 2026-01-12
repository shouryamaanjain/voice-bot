import { QdrantClient } from '@qdrant/js-client-rest';

let qdrantClient = null;

// ✅ OPTIMIZATION: Cache collection info to avoid getCollection() call on every request
// This saves ~150-500ms per request
let cachedCollectionInfo = null;

export function getQdrantClient() {
  if (qdrantClient) {
    return qdrantClient;
  }

  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
  const qdrantApiKey = process.env.QDRANT_API_KEY || null;
  
  try {
    const config = {
      url: qdrantUrl,
      timeout: 2000, // ✅ OPTIMIZATION: 2 second timeout for client operations (reduced from 5s)
    };
    
    if (qdrantApiKey) {
      config.apiKey = qdrantApiKey;
    }
    
    qdrantClient = new QdrantClient(config);
    return qdrantClient;
  } catch (error) {
    console.error('[Qdrant] ❌ Failed to initialize client:', error.message);
    throw error;
  }
}

/**
 * Ensure collection exists - call ONCE before processing chunks
 * Handles race conditions and validates collection configuration
 * ✅ OPTIMIZATION: Caches collection info to avoid getCollection() call on every request
 */
export async function ensureCollectionOnce(collectionName = null) {
  const name = collectionName || process.env.QDRANT_COLLECTION_NAME || 'document_chunks';
  
  // ✅ OPTIMIZATION: Return cached info if available (saves ~150-500ms per request)
  if (cachedCollectionInfo && cachedCollectionInfo.name === name) {
    console.log(`[Qdrant] ✅ Using cached collection info: ${name} (saved ~150-500ms)`);
    return cachedCollectionInfo;
  }
  
  const client = getQdrantClient();
  
  try {
    // Check if collection exists
    const collectionInfo = await client.getCollection(name).catch(() => null);
    
    if (collectionInfo) {
      // Validate collection configuration
      const vectors = collectionInfo.config?.params?.vectors;
      
      // Check if it's named vector (content) or single vector
      let vectorSize = null;
      let isNamedVector = false;
      
      if (vectors?.content) {
        // Named vector collection
        vectorSize = vectors.content.size;
        isNamedVector = true;
      } else if (vectors?.size) {
        // Single vector collection
        vectorSize = vectors.size;
        isNamedVector = false;
      }
      
      if (vectorSize && vectorSize !== 1536) {
        throw new Error(`Collection ${name} has wrong vector size: ${vectorSize}, expected 1536`);
      }
      
      console.log(`[Qdrant] ✅ Collection found: ${name}`);
      // ✅ OPTIMIZATION: Cache the result
      cachedCollectionInfo = { name, exists: true, info: collectionInfo, isNamedVector };
      return cachedCollectionInfo;
    }
    
    // Create collection if it doesn't exist
    // ✅ Use named vector (future-proof and recommended)
    try {
      await client.createCollection(name, {
        vectors: {
          content: {
            size: 1536, // OpenAI text-embedding-3-small dimension
            distance: 'Cosine', // Cosine similarity for embeddings
          },
        },
      });
      console.log('[Qdrant] ✅ Collection created:', name);
      const newCollectionInfo = await client.getCollection(name);
      // ✅ OPTIMIZATION: Cache the result
      cachedCollectionInfo = { name, exists: false, info: newCollectionInfo, isNamedVector: true };
      return cachedCollectionInfo;
    } catch (createError) {
      // Handle race condition: collection might have been created by another request
      if (createError.message?.includes('already exists') || createError.status === 409) {
        const existingInfo = await client.getCollection(name);
        // Detect vector type for existing collection
        const vectors = existingInfo.config?.params?.vectors;
        const isNamedVector = !!vectors?.content;
        // ✅ OPTIMIZATION: Cache the result
        cachedCollectionInfo = { name, exists: true, info: existingInfo, isNamedVector };
        return cachedCollectionInfo;
      }
      throw createError;
    }
  } catch (error) {
    console.error('[Qdrant] ❌ Error managing collection:', error.message);
    throw error;
  }
}

/**
 * @deprecated Use ensureCollectionOnce instead
 * Kept for backward compatibility
 */
export async function getOrCreateCollection(collectionName = null) {
  return ensureCollectionOnce(collectionName);
}

