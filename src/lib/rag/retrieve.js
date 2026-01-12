import { retrieveChunksFromQdrant } from './qdrant-retrieve.js';

/**
 * RAG Retrieval - Qdrant Implementation
 * 
 * Retrieves relevant document chunks from Qdrant vector database
 * using semantic similarity search.
 * 
 * @param {Object} params
 * @param {string} params.query - User query/question
 * @param {number} params.matchCount - Number of chunks to retrieve (default: 5)
 * @param {string} params.category - Optional category filter
 * @returns {Promise<Array>} Array of matching chunks with similarity scores
 */
export async function retrieveChunks({ query, matchCount = 5, category = null }) {
  if (!query || !query.trim()) {
    return [];
  }

  try {
    const chunks = await retrieveChunksFromQdrant({
      query: query.trim(),
      matchCount,
      category,
    });

    return chunks || [];
  } catch (error) {
    console.error('[RAG Retrieve] ❌ Error retrieving chunks:', error.message);
    
    // Handle OpenAI API key errors gracefully
    if (error.message?.includes('OPENAI_API_KEY') || error.message?.includes('API key')) {
      console.error('[RAG Retrieve] OpenAI API key is not configured');
      return [];
    }
    
    // Return empty array on other errors to allow graceful degradation
    return [];
  }
}
