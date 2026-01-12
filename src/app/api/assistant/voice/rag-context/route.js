import { NextResponse } from "next/server";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { ISHU_VOICE_PROMPT } from "@/lib/prompts/ishu-voice-prompt";
import { warmupLocalEmbedding } from "@/lib/clients/localEmbedding";

// ✅ OPTIMIZATION: Warmup embedding model on server startup (runs once)
let warmupPromise = null;
if (typeof window === 'undefined') { // Server-side only
  warmupPromise = warmupLocalEmbedding().catch(err => {
    console.error('[RAG Context] ⚠️ Embedding model warmup failed:', err.message);
    // Don't throw - allow server to start even if warmup fails
  });
}

// ✅ OPTIMIZATION: Cache default instructions at module level (computed once)
let DEFAULT_INSTRUCTIONS_CACHE = null;

function getDefaultInstructions() {
  if (!DEFAULT_INSTRUCTIONS_CACHE) {
    DEFAULT_INSTRUCTIONS_CACHE = ISHU_VOICE_PROMPT;
  }
  return DEFAULT_INSTRUCTIONS_CACHE;
}

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

    // ✅ DIRECT QDRANT FETCH - No cache, always fetch from Qdrant for performance testing
    console.log(`[Voice Bot Timing] 🔄 Fetching directly from Qdrant...`);
    console.log(`[Voice Bot Timing]    📝 Query: "${question.trim().substring(0, 80)}${question.trim().length > 80 ? '...' : ''}"`);

    // ✅ OPTIMIZATION: Use cached default instructions
    const defaultInstructionsStartTime = Date.now();
    const defaultInstructions = getDefaultInstructions();
    const defaultInstructionsDuration = Date.now() - defaultInstructionsStartTime;
    if (defaultInstructionsDuration > 1) {
      console.log(`[Voice Bot Timing]    ⏱️  Default Instructions Load: ${defaultInstructionsDuration}ms`);
    }

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
        // ⏱️ STEP 2.1.3: Building Context Block
        const contextBuildStartTime = Date.now();
        console.log(`[Voice Bot Timing] 🔄 STEP 2.1.3: Building context block...`);
        console.log(`[Voice Bot Timing]    📊 Chunks: ${chunks.length}`);
        
        const contextBlock = buildContextBlock(chunks);
        
        const contextBuildDuration = Date.now() - contextBuildStartTime;
        console.log(`[Voice Bot Timing] ✅ STEP 2.1.3: Context block built`);
        console.log(`[Voice Bot Timing]    ⏱️  Duration: ${contextBuildDuration}ms`);
        console.log(`[Voice Bot Timing]    📊 Size: ${contextBlock.length} characters`);
        
        // ✅ Build instructions with context (condensed for faster processing)
        const additionalInstructions = 
          "\n\n=== RELEVANT INFORMATION ===\n" +
          contextBlock + "\n=== END OF INFORMATION ===\n\n" +
          "Use ONLY the information above to answer. Answer naturally with Indian English patterns (\"See, basically...\", \"Actually...\", \"₹8 lakhs only\"). " +
          "Never mention 'context', 'knowledge base', 'information provided', or similar phrases. Answer as if you know this information directly. " +
          "ALWAYS start EVERY response with [Indian accent, Pace, Pitch, Tone, Length]. Child-friendly only.";
        
        const instructions = defaultInstructions + additionalInstructions;
        
        // ✅ OPTIMIZATION: Track and log total instruction size
        const defaultInstructionsSize = defaultInstructions.length;
        const additionalInstructionsSize = additionalInstructions.length;
        const totalInstructionsSize = instructions.length;
        const totalSizeKB = (totalInstructionsSize / 1024).toFixed(2);
        const totalSizeMB = (totalInstructionsSize / (1024 * 1024)).toFixed(3);
        
        console.log(`[Voice Bot Timing] 📊 Instruction Size Breakdown:`);
        console.log(`[Voice Bot Timing]    📝 Default Instructions: ${defaultInstructionsSize.toLocaleString()} chars (${(defaultInstructionsSize / 1024).toFixed(2)} KB)`);
        console.log(`[Voice Bot Timing]    📝 Additional Instructions: ${additionalInstructionsSize.toLocaleString()} chars (${(additionalInstructionsSize / 1024).toFixed(2)} KB)`);
        console.log(`[Voice Bot Timing]    📝 Context Block: ${contextBlock.length.toLocaleString()} chars (${(contextBlock.length / 1024).toFixed(2)} KB)`);
        console.log(`[Voice Bot Timing]    📊 Total Instructions: ${totalInstructionsSize.toLocaleString()} chars (${totalSizeKB} KB / ${totalSizeMB} MB)`);
        
        // ✅ Warn if total size exceeds recommended limits
        if (totalInstructionsSize > 50000) { // 50KB
          console.warn(`[Voice Bot Timing] ⚠️  Large instruction size (${totalSizeKB} KB) may impact Luna AI processing time`);
          console.warn(`[Voice Bot Timing]    💡 Consider reducing context chunks or optimizing system prompt`);
        }
        
        if (totalInstructionsSize > 100000) { // 100KB
          console.error(`[Voice Bot Timing] ❌ Very large instruction size (${totalSizeKB} KB) - may cause significant latency`);
          console.error(`[Voice Bot Timing]    💡 Strongly recommend reducing context chunks or system prompt size`);
        }

        // ⏱️ STEP 2.1.4: API Response Ready
        const totalApiDuration = Date.now() - apiStartTime;
        console.log(`[Voice Bot Timing] ✅ STEP 2.1.4: API response ready`);
        console.log(`[Voice Bot Timing]    ⏱️  Duration: ${totalApiDuration}ms`);
        console.log(`[Voice Bot Timing] ⏱️ ========================================`);
        console.log(`[Voice Bot Timing] 📊 COMPLETE API BREAKDOWN:`);
        const totalRequestHandlingTime = Date.now() - apiStartTime;
        const overheadTime = totalRequestHandlingTime - totalApiDuration;
        
        console.log(`[Voice Bot Timing]    ⏱️  RAG Retrieval (Embedding + Search): ${ragRetrievalDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  Context Building: ${contextBuildDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  API Processing: ${totalApiDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  Next.js Overhead: ${overheadTime}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  TOTAL REQUEST HANDLING: ${totalRequestHandlingTime}ms`);
        console.log(`[Voice Bot Timing] ⏱️ ========================================`);
        console.log(`[Voice Bot Timing] ℹ️  NOTE: Client-side logs (STEP 1, STEP 2, STEP 3) are in browser console`);

        // ✅ Direct Qdrant fetch - no cache
        const responseData = {
          context: contextBlock,
          instructions: instructions,
          chunksFound: chunks.length,
        };
        
        return NextResponse.json(responseData, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive', // ✅ Keep connection alive for reuse
            'Vary': 'Accept-Encoding', // ✅ Important for compression
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff', // ✅ Security header
            'X-Frame-Options': 'DENY', // ✅ Security header
          },
        });
      } else {
        // No chunks found - STRICT: Do not respond at all (handled client-side)
        // Return null context and instructions that will prevent response
        const noContextInstructions = 
          defaultInstructions + "\n\n" +
          "CRITICAL: No relevant information is available. DO NOT generate any response. DO NOT send any message. Stay completely silent. " +
          "This is a strict requirement - when no information is provided, you must remain silent.";

        // ⏱️ STEP 2.1.4: API Response Ready (No Context)
        const totalApiDuration = Date.now() - apiStartTime;
        console.log(`[Voice Bot Timing] ✅ STEP 2.1.4: API response ready (no context)`);
        console.log(`[Voice Bot Timing]    ⏱️  Duration: ${totalApiDuration}ms`);
        console.log(`[Voice Bot Timing] ⏱️ ========================================`);
        console.log(`[Voice Bot Timing] 📊 COMPLETE API BREAKDOWN (NO CONTEXT):`);
        const totalRequestHandlingTime = Date.now() - apiStartTime;
        const overheadTime = totalRequestHandlingTime - totalApiDuration;
        
        console.log(`[Voice Bot Timing]    ⏱️  RAG Retrieval: ${ragRetrievalDuration}ms (0 chunks found)`);
        console.log(`[Voice Bot Timing]    ⏱️  Context Building: SKIPPED (no chunks)`);
        console.log(`[Voice Bot Timing]    ⏱️  API Processing: ${totalApiDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  Next.js Overhead: ${overheadTime}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  TOTAL REQUEST HANDLING: ${totalRequestHandlingTime}ms`);
        console.log(`[Voice Bot Timing] ⏱️ ========================================`);
        console.log(`[Voice Bot Timing] ℹ️  NOTE: Client-side logs (STEP 1, STEP 2, STEP 3) are in browser console`);

        // ✅ Direct Qdrant fetch - no cache
        const responseData = {
          context: null,
          instructions: noContextInstructions,
          chunksFound: 0,
        };
        
        return NextResponse.json(responseData, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive', // ✅ Keep connection alive for reuse
            'Vary': 'Accept-Encoding', // ✅ Important for compression
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff', // ✅ Security header
            'X-Frame-Options': 'DENY', // ✅ Security header
          },
        });
      }
    } catch (ragError) {
      // Return default instructions if RAG retrieval fails
      return NextResponse.json({
        context: null,
        instructions: defaultInstructions,
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
