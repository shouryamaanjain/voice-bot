/**
 * OpenAI Client - Stub Implementation
 * 
 * This is a minimal stub for OpenAI embeddings.
 * Since the codebase uses local embeddings via smartEmbedding,
 * this file exists to satisfy imports.
 * 
 * If you need OpenAI embeddings, implement the actual OpenAI client here.
 */

/**
 * Generate embedding using OpenAI API
 * 
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Embedding vector (1536 dimensions)
 */
export async function generateEmbedding(text) {
  throw new Error(
    'OpenAI embeddings are not configured. ' +
    'The codebase is configured to use local embeddings only. ' +
    'If you need OpenAI embeddings, configure OPENAI_API_KEY environment variable and implement the OpenAI client.'
  );
}

/**
 * Get OpenAI client instance
 * 
 * @returns {object} OpenAI client (stub)
 */
export function getOpenAIClient() {
  throw new Error(
    'OpenAI client is not configured. ' +
    'The codebase is configured to use local embeddings only.'
  );
}
