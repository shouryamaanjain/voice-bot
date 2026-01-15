import { NextResponse } from "next/server";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { warmupLocalEmbedding } from "@/lib/clients/localEmbedding";

// ✅ OPTIMIZATION: Warmup embedding model on server startup (runs once)
let warmupPromise = null;
if (typeof window === 'undefined') { // Server-side only
  warmupPromise = warmupLocalEmbedding().catch(err => {
    console.error('[RAG Context] ⚠️ Embedding model warmup failed:', err.message);
    // Don't throw - allow server to start even if warmup fails
  });
}

// NOTE: System prompt (ISHU_VOICE_PROMPT) is no longer needed here
// It's set once at connection time in the offer API
// This endpoint now returns ONLY the RAG context for each message

// Similarity threshold - chunks below this score are considered irrelevant
// When context is irrelevant, we return null so Luna relies on system prompt
// (which has off-topic redirection rules)
const SIMILARITY_THRESHOLD = 0.25;

/**
 * Build context block from retrieved chunks for RAG integration
 */
function buildContextBlock(chunks) {
  if (!chunks || chunks.length === 0) {
    return "No matching knowledge base context was found.";
  }

  return chunks
    .map((chunk, index) => {
      const category = chunk.category || 'General';
      const fileName = chunk.file_name || 'Unknown';
      const label = `Source ${index + 1} (${category} • ${fileName})`;
      return `${label}:\n${chunk.content?.trim() || ''}`;
    })
    .join("\n\n");
}

/**
 * RAG Context Endpoint for Voice Chat
 * 
 * Fetches RAG context for a given question and returns updated instructions
 * This enables dynamic context updates during voice chat sessions
 */
export async function POST(request) {
  // ✅ OPTIMIZATION: Wait for warmup to complete if still in progress
  // This ensures model is ready before processing requests
  if (warmupPromise) {
    await warmupPromise;
    warmupPromise = null; // Clear promise after first completion
  }
  
  const apiStartTime = Date.now();
  console.log(`[Voice Bot Timing] ⏱️ ========================================`);
  console.log(`[Voice Bot Timing] 📥 API: RAG context request received`);
  console.log(`[Voice Bot Timing]    ⏱️  Time: ${new Date().toISOString()}`);
  console.log(`[Voice Bot Timing] ⏱️ ========================================`);
  
  try {
    const body = await request.json();
    const { question, category = null, sessionId = null, intent = null, matchCount = 5 } = body;

    if (!question || !question.trim()) {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400 }
      );
    }

    // ✅ OPTIMIZED: Returns only RAG context (system prompt set at connection time)
    console.log(`[Voice Bot Timing] 🔄 Fetching RAG context from Qdrant...`);
    console.log(`[Voice Bot Timing]    📝 Query: "${question.trim().substring(0, 80)}${question.trim().length > 80 ? '...' : ''}"`);

    // ⏱️ STEP 2.1.1 & 2.1.2: RAG Retrieval (Embedding + Vector Search)
    try {
      const ragRetrievalStartTime = Date.now();
      console.log(`[Voice Bot Timing] 🔄 STEP 2.1.1 & 2.1.2: Starting RAG retrieval...`);
      console.log(`[Voice Bot Timing]    📝 Query: "${question.trim().substring(0, 80)}..."`);
      console.log(`[Voice Bot Timing]    📊 MatchCount: ${matchCount || 5}`);
      
      // Retrieve relevant chunks from knowledge base
      const effectiveMatchCount = Math.max(matchCount || 5, 1);
      // ✅ Disable category filter temporarily (no index exists)
      const chunks = await retrieveChunks({ 
        query: question.trim(), 
        matchCount: effectiveMatchCount,
        category: null // ✅ No category filter
      });
      
      const ragRetrievalDuration = Date.now() - ragRetrievalStartTime;
      console.log(`[Voice Bot Timing] ✅ STEP 2.1.1 & 2.1.2: RAG retrieval completed`);
      console.log(`[Voice Bot Timing]    ⏱️  Total Duration: ${ragRetrievalDuration}ms`);
      console.log(`[Voice Bot Timing]    📊 Chunks found: ${chunks?.length || 0}`);
      console.log(`[Voice Bot Timing]    ℹ️  (See detailed embedding & vector search logs above)`);

      if (chunks && chunks.length > 0) {
        // ✅ Check similarity threshold - filter out irrelevant context
        const topSimilarity = chunks[0]?.similarity || 0;

        if (topSimilarity < SIMILARITY_THRESHOLD) {
          // Context is not relevant - return null so Luna uses system prompt guardrails
          const totalApiDuration = Date.now() - apiStartTime;
          console.log(`[Voice Bot Timing] ⚠️ STEP 2.1.3: Context below similarity threshold`);
          console.log(`[Voice Bot Timing]    📊 Top similarity: ${topSimilarity.toFixed(4)} < ${SIMILARITY_THRESHOLD} (threshold)`);
          console.log(`[Voice Bot Timing]    🚫 Returning null context - Luna will use system prompt guardrails`);
          console.log(`[Voice Bot Timing]    ⏱️  Duration: ${totalApiDuration}ms`);

          return NextResponse.json({
            context: null,
            chunksFound: 0,
            reason: 'below_threshold',
            topSimilarity: topSimilarity,
          }, {
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Connection': 'keep-alive',
              'Content-Type': 'application/json',
            },
          });
        }

        // ⏱️ STEP 2.1.3: Building Context Block
        const contextBuildStartTime = Date.now();
        console.log(`[Voice Bot Timing] 🔄 STEP 2.1.3: Building context block...`);
        console.log(`[Voice Bot Timing]    📊 Chunks: ${chunks.length}`);
        console.log(`[Voice Bot Timing]    ✅ Top similarity: ${topSimilarity.toFixed(4)} >= ${SIMILARITY_THRESHOLD} (threshold)`);
        
        const contextBlock = buildContextBlock(chunks);
        
        const contextBuildDuration = Date.now() - contextBuildStartTime;
        console.log(`[Voice Bot Timing] ✅ STEP 2.1.3: Context block built`);
        console.log(`[Voice Bot Timing]    ⏱️  Duration: ${contextBuildDuration}ms`);
        console.log(`[Voice Bot Timing]    📊 Size: ${contextBlock.length} characters`);
        
        // ✅ OPTIMIZATION: Return ONLY the context, not full instructions
        // System prompt is already set at connection time - no need to resend
        const contextSizeKB = (contextBlock.length / 1024).toFixed(2);
        console.log(`[Voice Bot Timing] 📊 Context Size: ${contextBlock.length.toLocaleString()} chars (${contextSizeKB} KB)`);
        console.log(`[Voice Bot Timing]    ✅ OPTIMIZED: Returning only context (not full instructions)`);

        // ⏱️ STEP 2.1.4: API Response Ready
        const totalApiDuration = Date.now() - apiStartTime;
        console.log(`[Voice Bot Timing] ✅ STEP 2.1.4: API response ready`);
        console.log(`[Voice Bot Timing]    ⏱️  Duration: ${totalApiDuration}ms`);
        console.log(`[Voice Bot Timing] ⏱️ ========================================`);
        console.log(`[Voice Bot Timing] 📊 COMPLETE API BREAKDOWN:`);
        const totalRequestHandlingTime = Date.now() - apiStartTime;
        
        console.log(`[Voice Bot Timing]    ⏱️  RAG Retrieval (Embedding + Search): ${ragRetrievalDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  Context Building: ${contextBuildDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  TOTAL REQUEST HANDLING: ${totalRequestHandlingTime}ms`);
        console.log(`[Voice Bot Timing] ⏱️ ========================================`);

        // ✅ OPTIMIZATION: Return only context, not instructions
        // Client will use this context directly without the 12KB+ system prompt
        const responseData = {
          context: contextBlock,
          chunksFound: chunks.length,
          // instructions field removed - system prompt is set at connection time
        };
        
        return NextResponse.json(responseData, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive',
            'Content-Type': 'application/json',
          },
        });
      } else {
        // No chunks found - return null context (client handles this)
        const totalApiDuration = Date.now() - apiStartTime;
        console.log(`[Voice Bot Timing] ✅ STEP 2.1.4: API response ready (no context found)`);
        console.log(`[Voice Bot Timing]    ⏱️  Duration: ${totalApiDuration}ms`);
        console.log(`[Voice Bot Timing]    📊 RAG Retrieval: ${ragRetrievalDuration}ms (0 chunks)`);

        return NextResponse.json({
          context: null,
          chunksFound: 0,
        }, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive',
            'Content-Type': 'application/json',
          },
        });
      }
    } catch (ragError) {
      // Return null context if RAG retrieval fails
      console.error(`[Voice Bot Timing] ❌ RAG retrieval error: ${ragError.message}`);
      return NextResponse.json({
        context: null,
        chunksFound: 0,
        error: ragError.message,
      });
    }
  } catch (error) {
    return NextResponse.json(
      { 
        error: "Failed to fetch RAG context", 
        details: error.message 
      },
      { status: 500 }
    );
  }
}
