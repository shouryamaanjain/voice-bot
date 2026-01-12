import { getQdrantClient, getOrCreateCollection, ensureCollectionOnce } from '../clients/qdrant.js';

import { generateQueryEmbedding } from '../clients/smartEmbedding.js';
import { randomUUID } from 'crypto';

/**
 * Store a document chunk in Qdrant
 * 
 * @param {Object} params
 * @param {string} params.document_id - Unique document identifier
 * @param {number} params.chunk_index - Index of chunk within document
 * @param {string} params.content - Text content of the chunk
 * @param {string} params.category - Category/topic of the chunk
 * @param {string} params.file_name - Original filename
 * @param {number[]} params.embedding - Vector embedding (1536 dimensions)
 * @returns {Promise<{success: boolean, pointId?: string, error?: string}>}
 */
/**
 */
export async function storeChunkInQdrant({
  document_id,
  chunk_index,
  content,
  category,
  file_name,
  embedding,
  collectionName, // Collection name must be provided (created beforehand)
  isNamedVector = true, // Default to named vector (recommended)
}) {
  const client = getQdrantClient();
  
  if (!collectionName) {
    throw new Error('Collection name is required. Call ensureCollectionOnce() first.');
  }
  
  
  const pointId = randomUUID();
  
  
  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error(`Invalid embedding vector: expected array of 1536 numbers, got ${embedding?.length || 0} items`);
  }
  
  if (embedding.some(v => typeof v !== 'number' || isNaN(v))) {
    throw new Error('Invalid embedding: all values must be numbers');
  }
  
  // ✅ Build payload with original ID for reference
  const payload = {
    document_id: String(document_id || ''),
    chunk_index: Number(chunk_index || 0),
    chunk_id: `${document_id}_${chunk_index}`, 
    text: String(content || ''),
  };
  
 
  if (category && String(category).trim()) {
    payload.category = String(category);
  }
  
  if (file_name && String(file_name).trim()) {
    payload.file_name = String(file_name);
  }
  

  let vectorPayload;
  if (isNamedVector) {
    
    vectorPayload = {
      content: embedding,
    };
  } else {
    
    vectorPayload = embedding; 
  }
  
  try {
    
    try {
      JSON.parse(JSON.stringify(payload));
    } catch (e) {
      console.error('[Qdrant] ❌ Payload cannot be JSON serialized:', e);
      throw new Error('Invalid payload structure');
    }
    
    await client.upsert(collectionName, {
      wait: true,
      points: [
        {
          id: pointId,
          vector: vectorPayload,
          payload: payload,
        },
      ],
    });
    
    console.log(`[Qdrant] ✅ Stored chunk: ${payload.chunk_id}`);
    return { success: true, pointId, chunkId: payload.chunk_id };
  } catch (error) {
    console.error(`[Qdrant] ❌ Error storing chunk ${payload.chunk_id}:`, error.message);
    
    if (error.response?.data) {
      console.error('[Qdrant] Error details:', JSON.stringify(error.response.data, null, 2));
    }
    
    throw error;
  }
}

/**
 * 
 * 
 * @param {Object} params
 * @param {string} params.query - Query text
 * @param {number[]} params.queryEmbedding - Pre-generated query embedding (optional)
 * @param {number} params.matchCount - Number of chunks to retrieve (default: 5)
 * @param {string} params.category - Filter by category (optional)
 * @returns {Promise<Array>} Array of matching chunks with similarity scores
 */
export async function retrieveChunksFromQdrant({
  query,
  queryEmbedding = null,
  matchCount = 5,
  category = null,
}) {
  const client = getQdrantClient();
  
  const collectionInfo = await ensureCollectionOnce();
  const collectionName = collectionInfo.name;
  const isNamedVector = collectionInfo.isNamedVector !== false; // Default to true (named vector)
  
  
  let embedding = queryEmbedding;
  if (!embedding) {

    const embeddingStartTime = Date.now();
    console.log(`[Voice Bot Timing] 🔄 STEP 2.1.1: Generating LOCAL embedding...`);
    console.log(`[Voice Bot Timing]    📝 Query: "${query.substring(0, 50)}..."`);
    
    
    embedding = await generateQueryEmbedding(query, {
      useLocal: true,
      fallbackToOpenAI: false, 
    });
    
    const embeddingDuration = Date.now() - embeddingStartTime;
    console.log(`[Voice Bot Timing] ✅ STEP 2.1.1: Embedding generated`);
    console.log(`[Voice Bot Timing]    ⏱️  Duration: ${embeddingDuration}ms`);
    console.log(`[Voice Bot Timing]    📊 Dimensions: ${embedding.length}`);
  } else {
    console.log(`[Voice Bot Timing] ℹ️ STEP 2.1.1: Using provided embedding (${embedding.length} dimensions)`);
  }
  
  // Validate embedding
  if (!Array.isArray(embedding) || embedding.length !== 1536 || embedding.some(v => typeof v !== 'number' || isNaN(v))) {
    console.error('[Qdrant] ❌ Invalid embedding');
    
    if (process.env.NODE_ENV === 'development') {
      console.error(`[Qdrant] Embedding details:`, {
        isArray: Array.isArray(embedding),
        length: embedding?.length,
        firstFew: embedding?.slice(0, 5),
        hasNaN: embedding?.some(v => isNaN(v))
      });
    }
    return [];
  }
  
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Qdrant] Embedding validated: ${embedding.length}d, sample values: [${embedding.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`);
  }
  
  try {
    
    let filter = category
      ? {
          must: [
            {
              key: 'category',
              match: { value: category },
            },
          ],
        }
      : undefined;
    
    
    const vectorPayload = isNamedVector
      ? {
          name: 'content',  
          vector: embedding, 
        }
      : embedding; 
    
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Qdrant] Using ${isNamedVector ? 'named' : 'single'} vector format`);
    }
    
    
    const vectorSearchStartTime = Date.now();
    console.log(`[Voice Bot Timing] 🔄 STEP 2.1.2: Starting Qdrant vector similarity search...`);
    console.log(`[Voice Bot Timing]    📊 MatchCount: ${matchCount}`);
    
    let searchResult;
    
    
    if (filter) {
      try {
        searchResult = await client.search(collectionName, {
          vector: vectorPayload,
          limit: matchCount,
          filter,
          with_payload: true,

          timeout: 500, 
        });
      } catch (filterError) {
        
        const errorMessage = filterError.message || '';
        const errorData = filterError.data?.status?.error || '';
        const fullErrorText = `${errorMessage} ${errorData}`.toLowerCase();
        
        
        if (fullErrorText.includes('index required') || 
            (fullErrorText.includes('index') && fullErrorText.includes('category'))) {
          console.warn(`[Qdrant] ⚠️ Category filter failed (no index), retrying without category filter`);
          filter = undefined; // Remove filter
          searchResult = await client.search(collectionName, {
            vector: vectorPayload,
            limit: matchCount,
            with_payload: true,
            
          });
        } else {
          throw filterError; 
        }
      }
    } else {
      
      searchResult = await client.search(collectionName, {
        vector: vectorPayload,
        limit: matchCount,
        with_payload: true,
        
        timeout: 500, 
      });
    }
    
    
    const vectorSearchDuration = Date.now() - vectorSearchStartTime;
    console.log(`[Voice Bot Timing] ✅ STEP 2.1.2: Vector search completed`);
    console.log(`[Voice Bot Timing]    ⏱️  Duration: ${vectorSearchDuration}ms`);
    
    
    console.log(`[Qdrant] ✅ Search completed: ${searchResult?.length || 0} chunks found`);
    if (searchResult && searchResult.length > 0) {
      const topScore = searchResult[0]?.score?.toFixed(4) || 'N/A';
      console.log(`[Voice Bot Timing]    📊 Chunks: ${searchResult.length} | Top similarity: ${topScore}`);
    
      if (process.env.NODE_ENV === 'development') {
        const topScores = searchResult.slice(0, 3).map(r => ({
          score: r.score?.toFixed(4),
          hasContent: !!r.payload?.text,
          contentPreview: r.payload?.text?.substring(0, 50) + '...'
        }));
        console.log(`[Qdrant] Top similarity scores:`, topScores);
      }
    } else {
      
      try {
        const collectionInfo = await client.getCollection(collectionName);
        const pointsCount = collectionInfo.points_count || 0;
        console.warn(`[Qdrant] ⚠️ No chunks found. Collection info:`);
        console.warn(`[Qdrant]   - Collection name: ${collectionName}`);
        console.warn(`[Qdrant]   - Points count: ${pointsCount}`);
        console.warn(`[Qdrant]   - Vector config:`, JSON.stringify(collectionInfo.config?.params?.vectors, null, 2));
        
        if (pointsCount === 0) {
          console.error(`[Qdrant] ❌ Collection is EMPTY - no documents uploaded!`);
        } else {
          console.warn(`[Qdrant] ⚠️ Collection has ${pointsCount} points but search returned 0 results`);
          console.warn(`[Qdrant]   Possible causes:`);
          console.warn(`[Qdrant]   1. Embedding dimension mismatch (query: ${embedding.length}d)`);
          console.warn(`[Qdrant]   2. Vector format mismatch (using ${isNamedVector ? 'named' : 'single'} vector)`);
          console.warn(`[Qdrant]   3. All similarity scores below threshold`);
        }
      } catch (infoError) {
        console.error(`[Qdrant] Could not fetch collection info:`, infoError.message);
      }
    }
    
    return searchResult.map((result) => ({
      id: result.id,
      document_id: result.payload?.document_id || null,
      chunk_index: result.payload?.chunk_index || null,
      chunk_id: result.payload?.chunk_id || null, 
      content: result.payload?.text || result.payload?.content || '', 
      category: result.payload?.category || null,
      file_name: result.payload?.file_name || null,
      similarity: result.score || null, 
    }));
  } catch (error) {
    console.error('[Qdrant] ❌ Error retrieving chunks:', error.message);
    
    
    if (error.data) {
      console.error('[Qdrant] Error data:', JSON.stringify(error.data, null, 2));
    }
    if (error.response?.data) {
      console.error('[Qdrant] Response data:', JSON.stringify(error.response.data, null, 2));
    }
    
    throw error;
  }
}

