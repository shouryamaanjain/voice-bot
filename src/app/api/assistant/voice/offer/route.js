import { NextResponse } from "next/server";
// Import form-data and axios for server-side FormData (required for Node.js)
import FormDataNode from "form-data";
import axios from "axios";
import https from "https";
// Import RAG retrieval function for context enrichment
import { retrieveChunks } from "@/lib/rag/retrieve";
// Import the single source of truth for system prompt
import { ISHU_VOICE_PROMPT } from "@/lib/prompts/ishu-voice-prompt";

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
 * WebRTC Session Endpoint
 * 
 * Handles WebRTC SDP offer/answer exchange with LUNA AI backend.
 * 
 * This endpoint matches the LUNA AI API structure from docs:
 * - Endpoint: ${BACKEND_URL}/v1/realtime/calls (configured via environment variable)
 * - Uses FormData with SDP and session config
 * - Auth: X-Luna-Key header with Bearer token
 * 
 * Session configuration:
 * - type: "realtime"
 * - model: "lunav1"
 * - audio: { output: { voice: "base" } }
 * - instructions: System prompt (optionally enriched with RAG context)
 */
export async function POST(request) {

  // Backend URL from environment variable (with trailing slash removed)
  const backendUrl = (process.env.BACKEND_URL || "https://upgrad.heypixa.ai").replace(/\/$/, "");
  
  // Hardcoded for testing
  const pixaApiKey = "lu_7f3b29e8c4a1462dba8fd91f53b7e2a1";
  // const pixaApiKey = process.env.PIXA_API_KEY;

  // if (!pixaApiKey) {
  //   console.error('[Voice Chat] ❌ PIXA_API_KEY environment variable is not set');
  //   console.error('[Voice Chat] 💡 Add PIXA_API_KEY to your .env.local file');
  //   return NextResponse.json(
  //     { 
  //       error: "PIXA_API_KEY environment variable is not set",
  //       details: "Please add PIXA_API_KEY to your .env.local file for local development",
  //       hint: "Check your production environment variables or contact your administrator for the API key"
  //     },
  //     { status: 500 }
  //   );
  // }

  try {
    // Get SDP offer from request body (can be text/plain or JSON)
    const contentType = request.headers.get("content-type") || "";
    console.log("[Voice Offer API] Content-Type:", contentType);
    let sdpOffer;
    let body = {};

    if (contentType.includes("application/json")) {
      body = await request.json();
      sdpOffer = body.sdp || body.offer;
      console.log("[Voice Offer API] Received JSON body, SDP length:", sdpOffer?.length || 0);
    } else {
      // Handle text/plain SDP directly
      sdpOffer = await request.text();
      console.log("[Voice Offer API] Received text SDP, length:", sdpOffer?.length || 0);
    }

    if (!sdpOffer) {
      console.error("[Voice Offer API] ❌ No SDP offer in request");
      return NextResponse.json(
        { error: "SDP offer is required" },
        { status: 400 }
      );
    }
    
    // Session config matching Luna playground format
    // All parameters are important for Luna to follow instructions properly
    const sessionConfig = {
      type: "realtime",
      model: "lunav1",
      audio: {
        output: {
          voice: body.voice || "base",
        },
      },
      // VAD settings for voice activity detection
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,  // Match playground (0.5)
      },
      // Enable audio transcription
      input_audio_transcription: {
        model: "lunav1",
      },
      // Generation parameters - critical for instruction following
      temperature: 0.8,
      top_p: 0.95,
      top_k: 50,
    };

    // HARDCODED: Always use ISHU_VOICE_PROMPT - ignore whatever client sends
    // This ensures guardrails and voice parameters are ALWAYS included
    const instructions = ISHU_VOICE_PROMPT;

    // Detailed logging to verify prompt is being sent correctly
    console.log(`[Voice Offer API] ========================================`);
    console.log(`[Voice Offer API] 📋 SYSTEM PROMPT VERIFICATION:`);
    console.log(`[Voice Offer API]    Length: ${instructions.length} chars`);
    console.log(`[Voice Offer API]    First 100 chars: "${instructions.substring(0, 100)}..."`);
    console.log(`[Voice Offer API]    Last 100 chars: "...${instructions.substring(instructions.length - 100)}"`);
    console.log(`[Voice Offer API]    Contains guardrails: ${instructions.includes('FORBIDDEN TOPICS') ? 'YES' : 'NO'}`);
    console.log(`[Voice Offer API]    Contains voice params: ${instructions.includes('Indian accent') ? 'YES' : 'NO'}`);
    console.log(`[Voice Offer API] ========================================`);
    console.log(`[Voice Offer API] ℹ️  NO data channel messages will be sent (matching playground behavior)`);

    sessionConfig.instructions = instructions;

    // Log the full session config being sent
    console.log(`[Voice Offer API] 📤 Session config:`, JSON.stringify({
      ...sessionConfig,
      instructions: `[${instructions.length} chars - truncated for logging]`
    }, null, 2));

    // REMOVED: 60KB hardcoded defaultInstructions - now using imported ISHU_VOICE_PROMPT
    // REMOVED: Fallback logic - already handled in the let statement above


    // Create FormData using form-data package (required for Node.js server-side)
    const formData = new FormDataNode();
    formData.append("sdp", sdpOffer);
    formData.append("session", JSON.stringify(sessionConfig));

    // Call LUNA AI API using axios (better FormData support in Node.js)
    // Configure HTTPS agent to handle SSL certificates
    // For EC2/production, allow unverified certs if explicitly set (for troubleshooting)
    const isProduction = process.env.NODE_ENV === 'production';
    const allowUnverifiedCerts = process.env.ALLOW_UNVERIFIED_SSL === 'true';
    
    const httpsAgent = new https.Agent({
      rejectUnauthorized: isProduction && !allowUnverifiedCerts,
      // In development or if explicitly allowed, we allow unverified certificates
      keepAlive: true,
    });

    let response;
    try {
      console.log("[Voice Offer API] 📤 Sending request to Luna AI API...");
      // console.log("[Voice Offer API] Environment:", process.env.NODE_ENV);
      // console.log("[Voice Offer API] SSL verification:", process.env.NODE_ENV === 'production' ? 'enabled' : 'disabled');
      
      response = await axios.post(
        `${backendUrl}/v1/realtime/calls`,
        formData,
        {
          headers: {
            "X-Luna-Key": `Bearer ${pixaApiKey}`,
            ...formData.getHeaders(), // Important: Include form-data headers
          },
          responseType: "text", // Luna API returns SDP as text
          timeout: 30000, // 30 second timeout
          httpsAgent: httpsAgent, // Use custom HTTPS agent for SSL handling
          maxBodyLength: Infinity, // Allow large FormData payloads
          maxContentLength: Infinity,
        }
      );
      
      console.log("[Voice Offer API] ✅ Received response from Luna AI, status:", response.status);
      console.log("[Voice Offer API] Response SDP length:", response.data?.length || 0);
    } catch (axiosError) {
      console.error("[Voice Offer API] ❌ Axios error:", axiosError.message);
      console.error("[Voice Offer API] ❌ Error code:", axiosError.code);
      
      if (axiosError.response) {
        // Server responded with error status
        const status = axiosError.response.status;
        const errorText = axiosError.response.data || axiosError.response.statusText;
        console.error("[Voice Offer API] ❌ Response status:", status);
        console.error("[Voice Offer API] ❌ Response data:", typeof errorText === 'string' ? errorText.substring(0, 500) : errorText);
        
        // Check if it's a firewall/network block (FortiGuard, etc.)
        const isHtmlResponse = typeof errorText === 'string' && errorText.includes('<!DOCTYPE html>');
        const isFortiGuard = isHtmlResponse && (
          errorText.includes('FortiGuard') || 
          errorText.includes('Access Blocked') ||
          errorText.includes('Web Page Blocked')
        );
        
        // Provide more specific error messages
        let errorMessage = "Failed to create voice session";
        if (status === 401) {
          errorMessage = "Invalid API key. Please check your PIXA_API_KEY configuration.";
        } else if (status === 403) {
          if (isFortiGuard) {
            errorMessage = `Network firewall is blocking access to ${backendUrl}. Please contact your network administrator to whitelist this domain, or use a different network/VPN.`;
          } else {
            errorMessage = "Access forbidden. Please check your API key permissions.";
          }
        } else if (status === 429) {
          errorMessage = "Rate limit exceeded. Please try again later.";
        } else if (status === 500) {
          errorMessage = "Luna AI service error. Please try again later.";
        } else if (errorText && !isHtmlResponse) {
          errorMessage = typeof errorText === 'string' ? errorText : JSON.stringify(errorText);
        }
        
        return NextResponse.json(
          { 
            error: errorMessage,
            ...(isFortiGuard && { 
              details: "Your network security system (FortiGuard) is blocking access to the Luna AI API. This requires network-level configuration.",
              suggestion: `Contact your IT administrator to whitelist ${backendUrl}, or try using a different network connection.`
            })
          },
          { status: status }
        );
      } else if (axiosError.request) {
        // Request made but no response - network issue
        console.error("[Voice Offer API] ❌ Network error - no response from server");
        console.error("[Voice Offer API] ❌ Error details:", {
          code: axiosError.code,
          message: axiosError.message,
          syscall: axiosError.syscall,
          address: axiosError.address,
          port: axiosError.port,
          hostname: axiosError.hostname,
        });
        
        // Check for specific network errors and provide helpful messages
        if (axiosError.code === 'ECONNREFUSED') {
          return NextResponse.json(
            { 
              error: `Connection refused to ${backendUrl}`,
              code: "ECONNREFUSED",
              details: "The server refused the connection. This may be due to firewall rules or the service being unavailable.",
              suggestion: `Check EC2 security group allows outbound HTTPS (port 443) to ${backendUrl}. Also verify the Luna AI service is operational.`
            },
            { status: 503 }
          );
        } else if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {
          return NextResponse.json(
            { 
              error: `Connection timeout to ${backendUrl}`,
              code: axiosError.code,
              details: "The connection timed out. This may be due to network latency, firewall blocking, or the service being slow to respond.",
              suggestion: `Check EC2 security group and network ACLs allow outbound HTTPS to ${backendUrl}. Consider increasing timeout if network is slow.`
            },
            { status: 504 }
          );
        } else if (axiosError.code === 'ENOTFOUND') {
          return NextResponse.json(
            { 
              error: `DNS resolution failed for ${backendUrl}`,
              code: "ENOTFOUND",
              details: "Could not resolve the hostname. This may be due to DNS configuration issues.",
              suggestion: "Ensure EC2 instance can resolve DNS. Check /etc/resolv.conf and verify DNS servers are configured correctly."
            },
            { status: 503 }
          );
        } else if (axiosError.code === 'CERT_HAS_EXPIRED' || axiosError.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          return NextResponse.json(
            { 
              error: "SSL certificate verification failed",
              code: axiosError.code,
              details: "The SSL certificate could not be verified. This may be due to certificate issues or system clock being incorrect.",
              suggestion: "Set ALLOW_UNVERIFIED_SSL=true in environment variables to bypass SSL verification (for troubleshooting only). Also verify system time is correct."
            },
            { status: 503 }
          );
        }
        
        throw new Error(`Failed to connect to Luna API: ${axiosError.message} (code: ${axiosError.code})`);
      } else {
        // Error setting up request
        console.error("[Voice Offer API] ❌ Request setup error");
        throw new Error(`Failed to setup request: ${axiosError.message}`);
      }
    }

    // Return SDP answer (as text, matching LUNA API response)
    const answer = response.data;
    
    // Include context chunks in response headers if available
    const headers = {
      "Content-Type": "application/sdp",
    };
    
    // Store context in headers as base64-encoded JSON (to avoid header size limits, we'll use a different approach)
    // Instead, we'll return context in a separate endpoint call or send it directly as conversation message
    // For now, we'll pass it via a custom header (limited size) or fetch it again in the client
    
    return new NextResponse(answer, {
      status: 200,
      headers: headers,
    });
  } catch (error) {
    console.error("[Voice Offer API] ❌ Unexpected error:", {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines of stack
    });
    
    return NextResponse.json(
      { 
        error: "Failed to process WebRTC session", 
        details: error.message,
        // Include error code if available
        ...(error.code && { code: error.code }),
        // Only include stack in development
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      },
      { status: 500 }
    );
  }
}

