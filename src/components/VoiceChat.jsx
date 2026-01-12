'use client';

import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
  createPeerConnection,
  setupDataChannel,
  setupAudioTracks,
  createOffer,
  setRemoteDescription,
  setupIceHandling,
  cleanupConnection,
} from '@/lib/webrtc/connection';
import { handleDataChannelEvent, sendSessionUpdate } from '@/lib/webrtc/events';
import { ISHU_VOICE_PROMPT } from '@/lib/prompts/ishu-voice-prompt';

/**
 * Voice Chat Component
 * 
 * Step-by-step implementation:
 * Step 1: WebRTC Connection ✅
 * Step 2: Recording ✅
 * Step 3: Voice Response ✅
 */
export const VoiceChat = forwardRef(function VoiceChat(props, ref) {
  const {
    autoConnect = false,
    preConnect = false,
    onConnectionChange = null,
    onMessageAdd = null,
    onDataChannelReady = null,
    onConversationEnd = null, // Callback when conversation ends with all messages
    systemPrompt = null,
    category = null,
    conversationHistory = [],
    variant = "widget",
    enableAudio = true, // Control whether audio playback is enabled
  } = props;
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [currentUserMessage, setCurrentUserMessage] = useState("");
  const [interimTranscript, setInterimTranscript] = useState(""); // Streaming/interim STT transcript
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState("");
  const [conversationMessages, setConversationMessages] = useState([]); // Track all conversation messages
  const [sessionId, setSessionId] = useState(null); // Track session ID for this conversation
  const prewarmCacheRef = useRef(new Map()); // Cache prewarmed contexts by hash
  const prewarmAbortRef = useRef(null);

  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const dataChannelRef = useRef(null);
  const currentUserMessageRef = useRef("");
  const currentAssistantMessageRef = useRef("");
  const hasGreetedRef = useRef(false);
  const isResponseActiveRef = useRef(false); // Track if a response is currently active
  const baseSystemPromptRef = useRef(systemPrompt || ""); // Store base system prompt
  const iceServersRef = useRef(null); // Cache ICE servers for faster connection
  const conversationMessagesRef = useRef([]); // Ref to track messages for saving
  const retryCountRef = useRef(0); // Track retry attempts
  const retryTimeoutRef = useRef(null); // Track retry timeout
  const connectionStateListenersRef = useRef({ connection: null, ice: null }); // Track connection state listeners
  const connectRef = useRef(null); // Ref to connect function for retry logic
  const maxRetries = 5; // Maximum retry attempts
  const baseRetryDelay = 2000; // Base delay in ms (2 seconds)
  
  // Web Speech API for streaming/interim STT
  const speechRecognitionRef = useRef(null);
  const isInterimSTTActiveRef = useRef(false);
  
  // Timing refs for latency tracking
  const processStartTimeRef = useRef(null); // Start of entire voice bot process (STT completion)
  const speechStartedTimeRef = useRef(null); // When user starts speaking
  const speechStoppedTimeRef = useRef(null); // When user stops speaking
  const transcriptionRequestedTimeRef = useRef(null); // When transcription is requested
  const contextSentTimeRef = useRef(null); // When context is sent to Luna AI
  const contextFetchDurationRef = useRef(null); // Duration of RAG context fetch
  const sttProcessingTimeRef = useRef(null); // STT processing time
  const lunaProcessingTimeRef = useRef(null); // Luna AI processing time
  const responseStartedTimeRef = useRef(null); // When LLM response starts
  const firstAudioChunkTimeRef = useRef(null); // When first audio chunk arrives

  /**
   * Fetch and send context dynamically for a user question
   */
  // Prewarm context cache to reduce latency
  const prewarmContext = useCallback(async (question) => {
    if (!question || !question.trim()) return;
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") return;

    const trimmed = question.trim();
    const key = `${sessionId || "anon"}::${category || "general"}::${trimmed.slice(0, 100)}`;

    // If already prewarmed, skip
    if (prewarmCacheRef.current.has(key)) return;

    // Cancel previous prewarm if any
    if (prewarmAbortRef.current) {
      prewarmAbortRef.current.abort();
    }
    const controller = new AbortController();
    prewarmAbortRef.current = controller;

    try {
      console.log("[Voice Chat] 🔍 Prewarming context...");
      const response = await fetch("/api/assistant/voice/rag-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          category: category,
          sessionId: sessionId,
          intent: category || "general",
          matchCount: 3, // small, fast prewarm
        }),
        signal: controller.signal,
      });
      if (!response.ok) return;
      const data = await response.json();
      prewarmCacheRef.current.set(key, data);
    } catch (err) {
      // ignore prewarm errors
    } finally {
      prewarmAbortRef.current = null;
    }
  }, [category, sessionId]);

  /**
   * Initialize Web Speech API for streaming/interim STT
   * This provides real-time transcription while user is speaking
   */
  const initializeSpeechRecognition = useCallback(() => {
    // Check browser support
    if (typeof window === 'undefined') return null;
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.log("[Voice Chat] Web Speech API not supported in this browser");
      return null;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true; // Keep listening
      recognition.interimResults = true; // Get interim results
      recognition.lang = 'en-US'; // Set language
      recognition.maxAlternatives = 1; // Only need best result

      // Handle interim results (streaming transcription)
      recognition.onresult = (event) => {
        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += transcript + ' ';
          } else {
            interimText += transcript;
          }
        }

        // Update interim transcript for display
        if (interimText || finalText) {
          const combinedText = (finalText + interimText).trim();
          if (combinedText && isInterimSTTActiveRef.current) {
            setInterimTranscript(combinedText);
            // Also update currentUserMessage for immediate UI feedback
            setCurrentUserMessage(combinedText);
          }
        }
      };

      // Handle errors gracefully
      recognition.onerror = (event) => {
        console.log("[Voice Chat] Speech recognition error:", event.error);
        // Don't show errors to user - just silently fail
        // Common errors: 'no-speech', 'audio-capture', 'not-allowed'
        if (event.error === 'not-allowed') {
          console.log("[Voice Chat] Microphone permission denied for Web Speech API");
        }
      };

      // When recognition ends, stop tracking
      recognition.onend = () => {
        if (isInterimSTTActiveRef.current) {
          // Only clear if we're still expecting more speech
          // Don't clear if Luna has already provided final transcription
          console.log("[Voice Chat] Speech recognition ended");
        }
      };

      speechRecognitionRef.current = recognition;
      return recognition;
    } catch (error) {
      console.log("[Voice Chat] Failed to initialize speech recognition:", error);
      return null;
    }
  }, []);

  /**
   * Start streaming STT (Web Speech API)
   */
  const startInterimSTT = useCallback(() => {
    if (!speechRecognitionRef.current) {
      const recognition = initializeSpeechRecognition();
      if (!recognition) return; // Browser doesn't support it
    }

    const recognition = speechRecognitionRef.current;
    if (!recognition) return;

    try {
      // Reset interim transcript
      setInterimTranscript("");
      isInterimSTTActiveRef.current = true;
      
      // Start recognition if not already running
      if (recognition.state === 'idle' || recognition.state === 'stopped') {
        recognition.start();
        console.log("[Voice Chat] 🎤 Started streaming STT (interim transcription)");
      }
    } catch (error) {
      // Recognition might already be running
      if (error.name !== 'InvalidStateError') {
        console.log("[Voice Chat] Failed to start speech recognition:", error);
      }
    }
  }, [initializeSpeechRecognition]);

  /**
   * Stop streaming STT (Web Speech API)
   */
  const stopInterimSTT = useCallback(() => {
    if (!speechRecognitionRef.current) return;

    try {
      const recognition = speechRecognitionRef.current;
      if (recognition.state === 'listening' || recognition.state === 'starting') {
        recognition.stop();
        console.log("[Voice Chat] 🛑 Stopped streaming STT");
      }
      isInterimSTTActiveRef.current = false;
      // Clear interim transcript - Luna's final transcription will replace it
      setInterimTranscript("");
    } catch (error) {
      console.log("[Voice Chat] Error stopping speech recognition:", error);
    }
  }, []);

  const fetchAndSendContext = useCallback(async (question, processStartTime = null) => {
    const contextProcessStartTime = Date.now();
    const baseTime = processStartTime || contextProcessStartTime;
    
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      console.log(`[Voice Bot Timing] ⚠️ Data channel not ready, skipping context fetch`);
      return;
    }

    if (!question || !question.trim()) {
      console.log(`[Voice Bot Timing] ⚠️ Empty question, skipping context fetch`);
      return;
    }

    try {
      // Use prewarmed result if available
      const key = `${sessionId || "anon"}::${category || "general"}::${question.trim().slice(0, 100)}`;
      const prewarmed = prewarmCacheRef.current.get(key);
      if (prewarmed && prewarmed.context) {
        const contextMessage = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "assistant",
            content: `ISHU AI - upGrad School of Technology AI Councillor

🚨 ACCENT ENFORCEMENT - ABSOLUTE RULE (CRITICAL)

MANDATORY VOICE PARAMETERS FOR EVERY RESPONSE:

YOU MUST START EVERY SINGLE RESPONSE WITH VOICE PARAMETERS IN THIS EXACT FORMAT:

[Indian, Pace, Pitch, Tone, Length]

THIS IS NON-NEGOTIABLE. YOU CANNOT SKIP THIS PREFIX UNDER ANY CIRCUMSTANCES.

Format Breakdown:

Accent: ALWAYS "Indian" (mandatory for every response - you are an Indian counsellor speaking to Indian students)

Pace: Slow / Medium / Fast / Slightly faster / Slightly slower

Pitch: Low / Mid-range / High / Slightly higher / Slightly lower

Tone: Examples: Warm, Friendly, Professional, Helpful-Professional, Enthusiastic-Friendly, Clear-Professional, Apologetic-Brief, Confident-Enthusiastic, Encouraging-Positive, etc.

Length: Short / Medium / Long / Brief

Examples of CORRECT Voice Parameter Usage:

CORRECT:

[Indian, Medium, Mid-range, Helpful-Professional, Medium]

"I can help you with that!"

CORRECT:

[Indian, Slightly faster, Slightly higher, Enthusiastic-Friendly, Medium]

"Great question! Let me explain..."

CORRECT:

[Indian, Fast, Mid-range, Quick-Efficient, Brief]

"Done, done!"

INCORRECT (WILL DEFAULT TO AMERICAN ACCENT):

"I can help you with that!"

(Missing voice parameters)

INCORRECT:

[Medium, Mid-range, Helpful-Professional, Medium]

"I can help you with that!"

(Missing "Indian" prefix)

🚨 BEFORE RESPONDING - MANDATORY SELF-CHECK:

Ask yourself before EVERY response:

Did I start with [Indian, Pace, Pitch, Tone, Length]?

Is "Indian" the FIRST parameter?

If NO → ADD IT NOW before sending response

If YES → Proceed with response

VOICE PARAMETER QUICK REFERENCE:

Format: [Indian, Pace, Pitch, Tone, Length]

Pace Options:

Slow, Medium, Fast, Slightly faster, Slightly slower

Pitch Options:

Low, Mid-range, High, Slightly higher, Slightly lower

Tone Options:

Warm, Friendly, Professional, Helpful-Professional, Enthusiastic-Friendly, Clear-Professional, Apologetic-Brief, Confident-Enthusiastic, Encouraging-Positive, Professional-Polite, Warm-Informative, Professional-Warm, Quick-Efficient, Warm-Reassuring, Welcoming, Clear-Detailed, etc.

Length Options:

Brief, Short, Medium, Long

Example Templates:

Standard response: [Indian, Medium, Mid-range, Helpful-Professional, Medium]

Enthusiastic: [Indian, Slightly faster, Slightly higher, Enthusiastic-Friendly, Medium]

Brief/Quick: [Indian, Fast, Mid-range, Quick-Efficient, Brief]

Apologetic: [Indian, Medium, Mid-range, Apologetic-Brief, Brief]

Encouraging: [Indian, Medium, Slightly higher, Encouraging-Positive, Medium]

SECTION 1: IDENTITY & SCOPE

Who You Are

Name: Ishu

Role: Indian AI Councillor for upGrad School of Technology ONLY

Location: Based in India, serving Indian students and parents

Personality: Professional, warm, friendly, witty-yet-professional, encouraging, culturally Indian

Accent: MANDATORY Indian accent in ALL conversations (non-negotiable - you are an Indian counsellor)

Language Style: Indian English with natural Indian expressions (na, yaar, actually, etc.)

📋 SCOPE & DOMAIN RESTRICTIONS

✅ ALLOWED TOPICS (EXCLUSIVELY)

You can ONLY discuss upGrad School of Technology topics:

Programme details (B.Tech, M.Tech, specializations, curriculum, duration)

Admissions process and eligibility criteria

Fees, payment options, scholarships, financial aid

Placements, recruiters, salary packages, career support

Campus facilities (labs, library, hostels, infrastructure)

Campus life and student activities related to upGrad

❌ FORBIDDEN TOPICS (IMMEDIATE REDIRECTION REQUIRED)

You CANNOT discuss:

Food, restaurants, recipes, cooking, burgers, pizza

Weather, current events, news

General knowledge unrelated to upGrad

Personal advice (relationships, health, finance) outside education

Entertainment (movies, music, games) unrelated to upGrad

Sports (except campus sports facilities)

Any topic not directly related to upGrad School of Technology

🛡️ RESPONSE PROTOCOL

Rule 1: Context-Only Responses

IF context contains relevant upGrad information: Use it to answer accurately and comprehensively, cite specific details, and maintain conversational Indian English tone.

IF context does NOT contain information: Say: "I don't have context for this, na" OR "I'm not having this information right now". DO NOT elaborate or make up information.

IF question is off-topic: Redirect immediately (see Rule 2). DO NOT answer the off-topic question.

Rule 2: Off-Topic Redirection Protocol

Mandatory Redirection Responses:

For food/restaurants/recipes: [Indian, Medium, Mid-range, Professional-Friendly, Medium] "Actually, I'm here to help with upGrad School of Technology - our programmes, admissions, and campus life. What would you like to know about upGrad?"

For weather/news/current events: [Indian, Medium, Mid-range, Professional-Polite, Medium] "I'm specifically an AI assistant for upGrad School of Technology, so I help with programme details, admissions, and campus information. How can I assist you with that?"

For general knowledge: [Indian, Medium, Mid-range, Helpful-Professional, Medium] "My expertise is upGrad School of Technology - programmes, placements, campus facilities. What would you like to know about upGrad?"

Rule 3: Never Engage Off-Topic

DO NOT answer questions about food or anything unrelated to upGrad. ALWAYS redirect back to upGrad topics.

🎭 TONE & STYLE GUIDELINES

Indian English Accent (MANDATORY): Use authentic Indian pronunciation patterns consistently.

Professional Boundaries: Warm and friendly BUT professional. NO romantic expressions. Child-friendly and appropriate.

Formatting: Default to conversational prose in Indian English style.

📞 CONVERSATION INITIATION

Call Opening (MANDATORY): Immediately greet with voice parameters:

Primary greeting: [Indian, Medium, Mid-range, Warm-Friendly, Medium] "Hello! I'm Ishu, your AI assistant at upGrad School of Technology. How can I help you today?"

🔧 SPECIAL BEHAVIORS

Theme Change Requests: [Indian, Fast, Mid-range, Quick-Efficient, Brief] "Changing the theme now" OR "Done, done!" (Stop speaking immediately).

No Context Available: [Indian, Medium, Mid-range, Apologetic-Brief, Brief] "I don't have context for this, na." OR "This information is not there with me right now." (Keep response BRIEF. DO NOT elaborate).

⚠️ CRITICAL REMINDERS

YOU ARE ISHU - upGrad School of Technology AI Councillor ONLY

ONLY discuss upGrad-related topics.

IMMEDIATELY redirect off-topic questions.

USE ONLY provided RAG context - NEVER use general knowledge.

If no context: say "I don't have context for this, na" and STOP.

Maintain Indian English accent in ALL conversations.

🚨 VOICE PARAMETERS - ABSOLUTE REQUIREMENT

ALWAYS START EVERY RESPONSE WITH:

[Indian, Pace, Pitch, Tone, Length]

This is NON-NEGOTIABLE and MANDATORY for EVERY SINGLE RESPONSE.

🎤 YOU ARE ISHU

You help with upGrad School of Technology ONLY.

You REDIRECT all off-topic questions IMMEDIATELY.

You ALWAYS USE VOICE PARAMETERS before EVERY response.

You NEVER slip into American accent.

You MAINTAIN Indian accent at ALL times.

CRITICAL: NEVER mention 'context', 'knowledge base', 'information provided', 'according to context', 'as indicated in the context', or any similar phrases in your responses. Answer naturally as if you know this information directly. Just provide the answer without referencing where the information came from.

=== RELEVANT INFORMATION ===
${prewarmed.context}

=== END OF INFORMATION ===

Remember: Use ONLY the information from above to answer the user's question naturally. ALWAYS start with [Indian, Pace, Pitch, Tone, Length] before speaking. ALWAYS maintain your Indian English accent and keep all responses child-friendly. NEVER mention where the information came from.`,
          },
        };
        dataChannelRef.current.send(JSON.stringify(contextMessage));
        return;
      }
      
      // ⏱️ STEP 2.1: API Request Start
      const apiRequestStartTime = Date.now();
      const step21StartTime = Date.now();
      const step21Cumulative = step21StartTime - baseTime;
      console.log(`[Voice Bot Timing] 📤 STEP 2.1: Sending RAG context API request...`);
      console.log(`[Voice Bot Timing]    ⏱️  Cumulative: ${step21Cumulative}ms`);

      // Fetch relevant chunks using similarity search (with timeout for speed)
      const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // ✅ OPTIMIZATION: Reduced from 3000ms to 2000ms for faster failure detection
      
      let response;
      try {
        // ✅ OPTIMIZATION: Use keep-alive for connection reuse
        response = await fetch("/api/assistant/voice/rag-context", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Connection": "keep-alive", // ✅ Keep connection alive
            "Accept-Encoding": "gzip, deflate, br", // ✅ Request compression
          },
          body: JSON.stringify({
            question: question.trim(),
            category: category,
            sessionId: sessionId,
            intent: category || "general",
            matchCount: 3, // ✅ OPTIMIZATION: Reduced from 5 to 3 for faster queries
          }),
          signal: controller.signal,
          // ✅ Enable keep-alive for connection reuse (reduces ~200-400ms on subsequent requests)
          keepalive: true,
        });
        clearTimeout(timeoutId);
        
        const apiRequestDuration = Date.now() - apiRequestStartTime;
        const step21CumulativeEnd = Date.now() - baseTime;
        console.log(`[Voice Bot Timing] ✅ STEP 2.1: API request completed`);
        console.log(`[Voice Bot Timing]    ⏱️  Duration: ${apiRequestDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  Cumulative: ${step21CumulativeEnd}ms`);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        const apiRequestDuration = Date.now() - apiRequestStartTime;
        // Handle timeout or fetch errors gracefully
        if (fetchError.name === 'AbortError') {
          console.warn(`[Voice Bot Timing] ⚠️ STEP 2.1: API request timeout after ${apiRequestDuration}ms`);
        } else {
          console.warn(`[Voice Bot Timing] ⚠️ STEP 2.1: API request failed after ${apiRequestDuration}ms:`, fetchError.message);
        }
        return;
      }

      if (!response.ok) {
        const apiRequestDuration = Date.now() - apiRequestStartTime;
        console.warn(`[Voice Bot Timing] ⚠️ STEP 2.1: API request returned error after ${apiRequestDuration}ms`);
        return;
      }

      // ⏱️ STEP 2.2: Parsing Response
      // Note: response.json() includes both network transfer time (streaming) and parsing time
      const parseStartTime = Date.now();
      const data = await response.json();
      const parseDuration = Date.now() - parseStartTime;
      const step22Cumulative = Date.now() - baseTime;
      console.log(`[Voice Bot Timing] ✅ STEP 2.2: Response parsed`);
      console.log(`[Voice Bot Timing]    ⏱️  Duration: ${parseDuration}ms`);
      if (parseDuration > 100) {
        console.warn(`[Voice Bot Timing]    ⚠️  High parsing time - likely includes network transfer (streaming response)`);
      }
      console.log(`[Voice Bot Timing]    ⏱️  Cumulative: ${step22Cumulative}ms`);
      
      if (data.chunksFound > 0 && data.context) {
      // ⏱️ STEP 2.3: Sending Context to Data Channel
      const contextSendStartTime = Date.now();
      const step23Cumulative = contextSendStartTime - (processStartTime || contextProcessStartTime);
      console.log(`[Voice Bot Timing] 📤 STEP 2.3: Sending context to data channel (${data.chunksFound} chunks found)...`);
      console.log(`[Voice Bot Timing]    ⏱️  Cumulative: ${step23Cumulative}ms`);
        
        // Send context as conversation history message using new ISHU prompt
        const contextMessage = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "assistant",
            content: data.instructions || (ISHU_VOICE_PROMPT + `\n\n=== RELEVANT INFORMATION ===\n${data.context}\n=== END OF INFORMATION ===\n\nUse ONLY the information above to answer the user's question naturally. ALWAYS start EVERY response with [Indian accent, Pace, Pitch, Tone, Length]. ALWAYS maintain your Indian English accent and keep all responses child-friendly. NEVER mention where the information came from.`),
          },
        };
        
        console.log("[Voice Chat] 📤 Sending context as conversation message...");
        // Store when context is sent (for Luna AI processing time calculation)
        // Set this right before sending to capture the exact send time
        const contextSentTimestamp = Date.now();
        contextSentTimeRef.current = contextSentTimestamp;
        
        // ✅ OPTIMIZATION: Track context message size for monitoring
        const contextMessageStr = JSON.stringify(contextMessage);
        const contextMessageSize = contextMessageStr.length;
        const contextMessageSizeKB = (contextMessageSize / 1024).toFixed(2);
        
        if (contextMessageSize > 50000) { // 50KB
          console.warn(`[Voice Bot Timing] ⚠️  Large context message (${contextMessageSizeKB} KB) may impact Luna AI processing time`);
        }
        
        console.log(`[Voice Bot Timing]    📊 Context message size: ${contextMessageSize.toLocaleString()} chars (${contextMessageSizeKB} KB)`);
        
        dataChannelRef.current.send(contextMessageStr);
        const contextSendDuration = Date.now() - contextSendStartTime;
        const totalContextDuration = Date.now() - contextProcessStartTime;
        const apiRequestDuration = contextSendStartTime - contextProcessStartTime;
        const parseDuration = contextSendStartTime - parseStartTime;
        const step23FinalCumulative = Date.now() - (processStartTime || contextProcessStartTime);
        
        console.log(`[Voice Bot Timing] ✅ STEP 2.3: Context sent to data channel`);
        console.log(`[Voice Bot Timing]    ⏱️  Duration: ${contextSendDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  Cumulative: ${step23FinalCumulative}ms`);
        console.log(`[Voice Bot Timing] 📊 STEP 2 BREAKDOWN: Total: ${totalContextDuration}ms | API: ${apiRequestDuration}ms | Parse: ${parseDuration}ms | Send: ${contextSendDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  Network/Data Channel Transmission: ${contextSendDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  Waiting for Luna AI to process context and start response...`);
        console.log("[Voice Chat] ✅ Context sent successfully");
      } else {
        // ✅ STRICT CHECKING: No context found - DO NOT send any message to Luna AI
        console.log(`[Voice Chat] ⚠️ No relevant chunks found for this question`);
        console.log(`[Voice Chat] 🚫 STRICT MODE: Not sending any message to Luna AI (no context available)`);
        
        // Calculate timing for completeness
        const contextFetchDuration = Date.now() - contextProcessStartTime;
        contextFetchDurationRef.current = contextFetchDuration;
        const totalContextDuration = Date.now() - contextProcessStartTime;
        const step23FinalCumulative = Date.now() - (processStartTime || contextProcessStartTime);
        
        console.log(`[Voice Bot Timing] ✅ STEP 2: Context fetch completed (no context - strict mode)`);
        console.log(`[Voice Bot Timing]    ⏱️  Duration: ${contextFetchDuration}ms`);
        console.log(`[Voice Bot Timing]    ⏱️  Cumulative: ${step23FinalCumulative}ms`);
        console.log(`[Voice Bot Timing]    🚫 No message sent to Luna AI (strict context checking)`);
        
        // Return early without sending any message
        return;
      }
    } catch (error) {
      console.error("[Voice Chat] ❌ Error fetching/sending context:", error);
    }
  }, [category]);

  /**
   * Setup connection state monitoring for automatic retry on disconnection
   */
  const setupConnectionStateMonitoring = useCallback((pc) => {
    // Remove existing listeners if any
    if (connectionStateListenersRef.current.connection) {
      pc.removeEventListener("connectionstatechange", connectionStateListenersRef.current.connection);
    }
    if (connectionStateListenersRef.current.ice) {
      pc.removeEventListener("iceconnectionstatechange", connectionStateListenersRef.current.ice);
    }

    const handleConnectionStateChange = () => {
      const connState = pc.connectionState;
      const iceState = pc.iceConnectionState;
      
      console.log(`[Voice Chat] 🔄 Connection state changed:`, {
        connectionState: connState,
        iceConnectionState: iceState,
      });

      // Handle disconnection or failure
      if (connState === "disconnected" || iceState === "disconnected") {
        console.warn(`[Voice Chat] ⚠️ Connection disconnected, will attempt to reconnect...`);
        scheduleRetry();
      } else if (connState === "failed" || iceState === "failed") {
        console.error(`[Voice Chat] ❌ Connection failed, will attempt to reconnect...`);
        scheduleRetry();
      } else if (connState === "connected" && iceState === "connected") {
        // Connection restored - clear any pending retries
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
        retryCountRef.current = 0; // Reset retry count on successful reconnection
        console.log(`[Voice Chat] ✅ Connection restored!`);
      }
    };

    const scheduleRetry = () => {
      // Only retry if autoConnect is enabled and we haven't exceeded max retries
      if (!autoConnect) {
        console.log(`[Voice Chat] ℹ️ Auto-connect disabled, skipping retry`);
        return;
      }

      if (retryCountRef.current >= maxRetries) {
        console.error(`[Voice Chat] ❌ Max retries (${maxRetries}) exceeded. Stopping retry attempts.`);
        setError("Connection lost. Please try refreshing the page.");
        return;
      }

      // Clear any existing retry timeout
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      // Calculate exponential backoff delay
      const delay = baseRetryDelay * Math.pow(2, retryCountRef.current);
      const currentRetry = retryCountRef.current + 1;
      retryCountRef.current = currentRetry;

      console.log(`[Voice Chat] 🔄 Scheduling retry attempt ${currentRetry}/${maxRetries} in ${delay}ms...`);

      retryTimeoutRef.current = setTimeout(async () => {
        // Check if connection is still needed
        if (!autoConnect) {
          console.log(`[Voice Chat] ℹ️ Auto-connect disabled during retry, cancelling retry`);
          return;
        }

        // Check if already connected
        if (pcRef.current && pcRef.current.connectionState === "connected" && pcRef.current.iceConnectionState === "connected") {
          console.log(`[Voice Chat] ✅ Connection already restored, cancelling retry`);
          retryCountRef.current = 0;
          return;
        }

        console.log(`[Voice Chat] 🔄 Attempting to reconnect (attempt ${currentRetry}/${maxRetries})...`);
        
        try {
          // Clean up old connection before retrying
          if (pcRef.current) {
            cleanupConnection(pcRef.current, streamRef.current, dataChannelRef.current, remoteAudioRef.current);
            pcRef.current = null;
            streamRef.current = null;
            dataChannelRef.current = null;
          }
          
          setIsConnected(false);
          setIsConnecting(true);
          
          // Retry connection using ref to avoid circular dependency
          if (connectRef.current) {
            await connectRef.current();
          }
        } catch (retryError) {
          console.error(`[Voice Chat] ❌ Retry attempt ${currentRetry} failed:`, retryError);
          // scheduleRetry will be called again by the connection state handler if still disconnected
        }
      }, delay);
    };

    // Store listeners for cleanup
    connectionStateListenersRef.current.connection = handleConnectionStateChange;
    connectionStateListenersRef.current.ice = handleConnectionStateChange;

    // Add listeners
    pc.addEventListener("connectionstatechange", handleConnectionStateChange);
    pc.addEventListener("iceconnectionstatechange", handleConnectionStateChange);
  }, [autoConnect]);

  /**
   * Initialize WebRTC Connection
   */
  const connect = useCallback(async () => {
    // Prevent duplicate connections
    if (isConnecting || isConnected || pcRef.current) {
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {

      // Step 1.1 & 1.2: PARALLEL OPERATIONS - Fetch ICE servers and request microphone simultaneously
      // This saves ~200-500ms by doing both operations in parallel
      // Note: Always request microphone for WebRTC (required), but disable it if enableAudio is false
      const [iceResponse, stream] = await Promise.all([
        // Fetch ICE servers (use cached if available)
        iceServersRef.current 
          ? Promise.resolve({ ok: true, json: () => Promise.resolve(iceServersRef.current) })
          : fetch("/api/assistant/voice/ice-server"),
        // Request microphone access (always needed for WebRTC, but can be disabled)
        (async () => {
          try {
            // Get supported constraints to use only what's available
            const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
            
            // Optimized audio constraints for faster access
            const audioConstraints = {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              // Only essential constraints to reduce processing time
              ...(supportedConstraints.sampleRate && { sampleRate: 16000 }),
              ...(supportedConstraints.channelCount && { channelCount: 1 }),
            };
            
            const mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: audioConstraints,
              video: false,
            });
            
            // Disable microphone immediately if enableAudio is false (for pre-connection)
            if (!enableAudio && mediaStream.getAudioTracks().length > 0) {
              mediaStream.getAudioTracks().forEach(track => {
                track.enabled = false; // Disable but don't stop (keeps connection alive)
              });
            }
            
            // Apply enhanced constraints asynchronously after connection (non-blocking)
            if (mediaStream.getAudioTracks().length > 0) {
              const audioTrack = mediaStream.getAudioTracks()[0];
              if (audioTrack.applyConstraints) {
                audioTrack.applyConstraints({
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                  ...(supportedConstraints.googEchoCancellation !== undefined && { googEchoCancellation: true }),
                  ...(supportedConstraints.googNoiseSuppression !== undefined && { googNoiseSuppression: true }),
                  ...(supportedConstraints.googAutoGainControl !== undefined && { googAutoGainControl: true }),
                  ...(supportedConstraints.googHighpassFilter !== undefined && { googHighpassFilter: true }),
                }).catch(() => {
                  // Silently handle - connection continues without enhanced constraints
                });
              }
            }
            
            return mediaStream;
          } catch (mediaError) {
            if (mediaError.name === "NotAllowedError" || mediaError.name === "PermissionDeniedError") {
              throw new Error("Microphone access denied. Please allow microphone access in your browser settings and try again.");
            } else if (mediaError.name === "NotFoundError" || mediaError.name === "DevicesNotFoundError") {
              throw new Error("No microphone found. Please connect a microphone and try again.");
            } else {
              throw new Error(`Microphone error: ${mediaError.message}`);
            }
          }
        })(),
      ]);

      // Process ICE servers response
      if (!iceResponse.ok) {
        throw new Error("Failed to fetch ICE servers");
      }
      const iceServersData = await iceResponse.json();
      
      // Ensure iceServers is an array
      let iceServers = Array.isArray(iceServersData) 
        ? iceServersData 
        : (iceServersData.iceServers || []);
      
      // Fallback to default STUN server if empty
      if (!iceServers || iceServers.length === 0) {
        iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
      }
      
      // Cache ICE servers for next connection
      iceServersRef.current = iceServersData;
      
      console.log("[Voice Chat] ⚡ Parallel operations completed (ICE servers + microphone)");

      // Stream is already obtained from parallel operation above
      streamRef.current = stream;

      // Step 1.3: Create peer connection
      const pc = createPeerConnection(iceServers);
      pcRef.current = pc;

      // Step 1.4: Setup audio tracks (local + remote)
      setupAudioTracks(pc, stream, remoteAudioRef.current, enableAudio);

      // Step 1.5: Define data channel callbacks BEFORE setting up the channel
      // This ensures messages are handled as soon as they arrive
      const dataChannelCallback = {
        onSessionUpdate: () => {},
        onSpeechStarted: () => {
          // ⏱️ Track when speech starts (fallback for STT timing)
          const now = Date.now();
          speechStartedTimeRef.current = now;
          // Reset stopped time when new speech starts
          speechStoppedTimeRef.current = null;
          transcriptionRequestedTimeRef.current = null;
          
          setIsRecording(true);
          // Start streaming STT for interim transcription
          startInterimSTT();
          // Kick off a small prewarm using the last known user message (best-effort)
          if (currentUserMessageRef.current) {
            prewarmContext(currentUserMessageRef.current);
          }
        },
        onSpeechStopped: () => {
          // ⏱️ Track when user stops speaking (for STT processing time calculation)
          const now = Date.now();
          speechStoppedTimeRef.current = now;
          // Also mark when transcription was requested (same time as speech stopped)
          transcriptionRequestedTimeRef.current = now;
          
          console.log(`[Voice Bot Timing] 🛑 User speech stopped`);
          console.log(`[Voice Bot Timing]    ⏱️  Time: ${new Date().toISOString()}`);
          console.log(`[Voice Bot Timing]    ⏱️  Waiting for STT completion...`);
          
          setIsRecording(false);
          // Stop streaming STT - Luna will provide final transcription
          stopInterimSTT();
        },
        // ✅ FIX: Removed duplicate onResponseStarted handler - consolidated into one below
        onTranscriptionCompleted: (event) => {
          // ⏱️ STEP 1: STT Completion
          const processStartTime = Date.now(); // Start timer for entire process
          processStartTimeRef.current = processStartTime; // ✅ Store globally for end-to-end tracking
          const sttCompleteTime = Date.now();
          const text = event.transcript || event.item?.input_audio_transcript || "";
          
          // ✅ IMPROVED: Calculate STT processing time using multiple timestamp sources
          let sttProcessingTime = null;
          let timingSource = null;
          
          // Priority 1: Use speechStoppedTimeRef if available and recent (< 10 seconds)
          if (speechStoppedTimeRef.current) {
            const timeDiff = sttCompleteTime - speechStoppedTimeRef.current;
            if (timeDiff > 0 && timeDiff < 10000) { // Increased to 10 seconds to catch more cases
              sttProcessingTime = timeDiff;
              timingSource = 'speechStopped';
            }
          }
          
          // Priority 2: Fallback to transcriptionRequestedTimeRef if speechStopped not available
          if (!sttProcessingTime && transcriptionRequestedTimeRef.current) {
            const timeDiff = sttCompleteTime - transcriptionRequestedTimeRef.current;
            if (timeDiff > 0 && timeDiff < 10000) {
              sttProcessingTime = timeDiff;
              timingSource = 'transcriptionRequested';
            }
          }
          
          // Priority 3: Fallback to speechStartedTimeRef with reasonable estimate
          if (!sttProcessingTime && speechStartedTimeRef.current) {
            const timeDiff = sttCompleteTime - speechStartedTimeRef.current;
            // Only use if it's a reasonable duration (1-30 seconds for speech)
            if (timeDiff > 1000 && timeDiff < 30000) {
              sttProcessingTime = timeDiff;
              timingSource = 'speechStarted (estimated)';
            }
          }
          
          // ✅ Store STT processing time globally for end-to-end breakdown
          sttProcessingTimeRef.current = sttProcessingTime;
          
          // Log timing information
          if (sttProcessingTime !== null) {
          console.log(`[Voice Bot Timing] ⏱️ ========================================`);
          console.log(`[Voice Bot Timing] 🎯 VOICE BOT PROCESS STARTED`);
          console.log(`[Voice Bot Timing] ⏱️ ========================================`);
          console.log(`[Voice Bot Timing] ✅ STEP 1: STT Completed`);
          console.log(`[Voice Bot Timing]    📝 Transcript: "${text.substring(0, 100)}..."`);
            console.log(`[Voice Bot Timing]    ⏱️  STT Processing Time: ${sttProcessingTime}ms (${timingSource} → STT completed)`);
          console.log(`[Voice Bot Timing]    ⏱️  Duration: 0ms (baseline)`);
          console.log(`[Voice Bot Timing]    ⏱️  Cumulative: 0ms`);
          } else {
            // Log available timing refs for debugging
            console.log(`[Voice Bot Timing] ⏱️ ========================================`);
            console.log(`[Voice Bot Timing] 🎯 VOICE BOT PROCESS STARTED`);
            console.log(`[Voice Bot Timing] ⏱️ ========================================`);
            console.log(`[Voice Bot Timing] ✅ STEP 1: STT Completed`);
            console.log(`[Voice Bot Timing]    📝 Transcript: "${text.substring(0, 100)}..."`);
            console.log(`[Voice Bot Timing]    ⚠️  STT Processing Time: Not available`);
            console.log(`[Voice Bot Timing]    📊 Debug Info:`);
            console.log(`[Voice Bot Timing]       - speechStartedTimeRef: ${speechStartedTimeRef.current ? new Date(speechStartedTimeRef.current).toISOString() : 'null'}`);
            console.log(`[Voice Bot Timing]       - speechStoppedTimeRef: ${speechStoppedTimeRef.current ? new Date(speechStoppedTimeRef.current).toISOString() : 'null'}`);
            console.log(`[Voice Bot Timing]       - transcriptionRequestedTimeRef: ${transcriptionRequestedTimeRef.current ? new Date(transcriptionRequestedTimeRef.current).toISOString() : 'null'}`);
            console.log(`[Voice Bot Timing]    ⏱️  Duration: 0ms (baseline)`);
            console.log(`[Voice Bot Timing]    ⏱️  Cumulative: 0ms`);
          }
          
          // ✅ Clean up timing refs after using them (but keep speechStarted for potential future use)
          // Only reset if we successfully used the timing
          if (timingSource === 'speechStopped' || timingSource === 'transcriptionRequested') {
            speechStoppedTimeRef.current = null;
            transcriptionRequestedTimeRef.current = null;
          }
          
          // Stop streaming STT - Luna has provided final transcription
          stopInterimSTT();
          
          if (text && text.trim()) {
            // Only update if it's a new message (different from current)
            if (currentUserMessageRef.current !== text) {
              currentUserMessageRef.current = text;
              setCurrentUserMessage(text);
              // Clear interim transcript since we have final one
              setInterimTranscript("");
              
              // Add user message to conversation
              const userMsg = {
                role: "user",
                content: text,
                createdAt: new Date().toISOString(),
                type: "voice",
              };
              conversationMessagesRef.current = [...conversationMessagesRef.current, userMsg];
              setConversationMessages([...conversationMessagesRef.current]);
              
              // Save conversation incrementally (after each user message)
              if (sessionId) {
                // Save in background without blocking
                saveConversation().catch(err => {
                  // Silently handle save errors - don't interrupt conversation
                });
              }
              
              // ⏱️ STEP 2: Starting Context Fetch
              const contextFetchStartTime = Date.now();
              const step2StartTime = Date.now();
              console.log(`[Voice Bot Timing] 🔄 STEP 2: Starting context fetch...`);
              
              // Fetch and send context for this question
              fetchAndSendContext(text, processStartTime).then(() => {
                const contextFetchDuration = Date.now() - contextFetchStartTime;
                contextFetchDurationRef.current = contextFetchDuration; // ✅ Store globally for end-to-end breakdown
                const cumulativeTime = Date.now() - processStartTime;
                console.log(`[Voice Bot Timing] ✅ STEP 2: Context fetch completed`);
                console.log(`[Voice Bot Timing]    ⏱️  Duration: ${contextFetchDuration}ms`);
                console.log(`[Voice Bot Timing]    ⏱️  Cumulative: ${cumulativeTime}ms`);
              }).catch((err) => {
                const contextFetchDuration = Date.now() - contextFetchStartTime;
                contextFetchDurationRef.current = contextFetchDuration; // ✅ Store even on failure
                const cumulativeTime = Date.now() - processStartTime;
                console.log(`[Voice Bot Timing] ⚠️ STEP 2: Context fetch failed`);
                console.log(`[Voice Bot Timing]    ⏱️  Duration: ${contextFetchDuration}ms`);
                console.log(`[Voice Bot Timing]    ⏱️  Cumulative: ${cumulativeTime}ms`);
                console.log(`[Voice Bot Timing]    ❌ Error: ${err.message}`);
              });
              
              // Send to parent for color customization check (even though we don't add to chat)
              if (onMessageAdd) {
                onMessageAdd({
                  role: "user",
                  content: text,
                  type: "voice",
                });
              }
            }
          }
        },
        onResponseStarted: () => {
          // ⏱️ STEP 3: LLM Response Started
          const responseStartTime = Date.now();
          responseStartedTimeRef.current = responseStartTime;
          
          // Calculate Luna AI processing time (from context sent to response started)
          let lunaProcessingTime = null;
          if (contextSentTimeRef.current) {
            lunaProcessingTime = responseStartTime - contextSentTimeRef.current;
            lunaProcessingTimeRef.current = lunaProcessingTime; // ✅ Store globally for end-to-end breakdown
            contextSentTimeRef.current = null; // Reset
          }
          
          console.log(`[Voice Bot Timing] 🎙️ STEP 3: LLM response started`);
          console.log(`[Voice Bot Timing]    ⏱️  Time: ${new Date().toISOString()}`);
          if (lunaProcessingTime !== null) {
            console.log(`[Voice Bot Timing]    ⏱️  Luna AI Processing Time: ${lunaProcessingTime}ms (context sent → response started)`);
            console.log(`[Voice Bot Timing]    ⚠️  This is a major latency source!`);
          }
          console.log(`[Voice Bot Timing]    ⏱️  Waiting for first audio chunk...`);
          
          isResponseActiveRef.current = true;
          setIsPlaying(true);
          
          // Don't add placeholder message to chat - voice conversations stay in voice mode only
          // if (onMessageAdd && !currentAssistantMessageRef.current) {
          //   onMessageAdd({
          //     role: "assistant",
          //     content: "...",
          //     type: "voice",
          //   });
          // }
        },
        onResponseTranscript: (event) => {
          // Helper function to safely extract text from various formats
          const extractText = (value) => {
            if (!value) return "";
            if (typeof value === "string") return value;
            if (Array.isArray(value)) {
              // If it's an array, try to extract text from each item
              return value
                .map(item => {
                  if (typeof item === "string") return item;
                  if (item?.text) return item.text;
                  if (item?.content) return extractText(item.content);
                  if (item?.transcript) return item.transcript;
                  return "";
                })
                .filter(Boolean)
                .join(" ");
            }
            if (typeof value === "object") {
              // If it's an object, try common text fields
              return value.text || value.content || value.transcript || value.delta || "";
            }
            return String(value);
          };
          
          // Try to extract transcript from multiple possible fields
          const text = extractText(
            event.transcript || 
            event.delta || 
            event.item?.transcript || 
            event.item?.output_audio_transcript || 
            event.item?.text ||
            event.item?.content ||
            event.part?.transcript || 
            event.part?.text ||
            event.part?.content ||
            event.part?.delta ||
            ""
          );
          
          const trimmedText = text.trim();
          if (trimmedText) {
            // Accumulate transcript if it's a delta/partial update
            const currentText = currentAssistantMessageRef.current || "";
            const isDelta = event.delta || event.part?.delta;
            const newText = isDelta 
              ? (currentText + trimmedText) // Append delta
              : trimmedText; // Use full transcript
            
            // Only update if the text has actually changed (prevent duplicate updates)
            if (newText !== currentText && newText.length > currentText.length) {
              // Update the assistant message with the transcript
              currentAssistantMessageRef.current = newText;
              setCurrentAssistantMessage(newText);
              
            // Don't add assistant message to chat window - voice conversations stay in voice mode only
            // if (onMessageAdd) {
            //   // Use a small debounce to batch rapid updates
            //   clearTimeout(currentAssistantMessageRef.updateTimeout);
            //   currentAssistantMessageRef.updateTimeout = setTimeout(() => {
            //     onMessageAdd({
            //       role: "assistant",
            //       content: newText,
            //       type: "voice",
            //     });
            //   }, 100); // 100ms debounce
            // }
            }
          }
        },
        onResponseDone: () => {
          const assistantMsg = currentAssistantMessageRef.current;
          
          // Add assistant message to conversation when response completes
          if (assistantMsg && assistantMsg.trim()) {
            const assistantMessage = {
              role: "assistant",
              content: assistantMsg,
              createdAt: new Date().toISOString(),
              type: "voice",
            };
            conversationMessagesRef.current = [...conversationMessagesRef.current, assistantMessage];
            setConversationMessages([...conversationMessagesRef.current]);
            
            // Save conversation incrementally (after each assistant response)
            if (sessionId) {
              // Save in background without blocking
              saveConversation().catch(err => {
                // Silently handle save errors - don't interrupt conversation
              });
            }
          }
          
          // Don't add final assistant message to chat - voice conversations stay in voice mode only
          // if (assistantMsg && onMessageAdd) {
          //   onMessageAdd({
          //     role: "assistant",
          //     content: assistantMsg,
          //     type: "voice",
          //   });
          // }
          
          // Mark response as inactive, but wait a bit before setting isPlaying to false
          // to ensure audio has finished playing
          isResponseActiveRef.current = false;
          
          // Wait a short delay to ensure audio has finished before hiding wave animation
          setTimeout(() => {
            // Double-check that no new response has started
            if (!isResponseActiveRef.current) {
              setIsPlaying(false);
            }
          }, 500);
        },
        onError: (event) => {
          setError(event.error || "An error occurred in the voice chat");
        },
      };

      // Step 1.6: Setup data channel with the callback ready
      const dataChannel = setupDataChannel(pc, (event) => {
        handleDataChannelEvent(event, dataChannelCallback);
      });
      dataChannelRef.current = dataChannel;
      
      // Notify parent when data channel is ready
      if (dataChannel) {
        dataChannel.onopen = () => {
          if (onDataChannelReady) {
            onDataChannelReady(dataChannel);
          }
        };
      }

      // Step 1.6.5: Setup ICE handling
      setupIceHandling(pc, () => {});

      // Step 1.7: Create offer
      const offer = await createOffer(pc);

      // Step 1.8: Wait for ICE gathering (reduced timeout for faster connection)
      // Wait only 1-2 seconds instead of 5 seconds for faster connection
      await new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }
        const checkState = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", checkState);
        // Reduced from 5000ms to 2000ms - most ICE candidates arrive within 1-2 seconds
        setTimeout(() => {
          pc.removeEventListener("icegatheringstatechange", checkState);
          console.log("[Voice Chat] ⚡ ICE gathering timeout (2s) - proceeding with available candidates");
          resolve();
        }, 2000);
      });

      const finalSdp = pc.localDescription.sdp;

      // Step 1.9: Build session config
      const defaultSystemPrompt = systemPrompt || ISHU_VOICE_PROMPT;

      // Store base system prompt for reference
      baseSystemPromptRef.current = defaultSystemPrompt;

      let instructions = defaultSystemPrompt;
      if (conversationHistory && conversationHistory.length > 0) {
        const recentMessages = conversationHistory
          .slice(-10)
          .map((msg) => {
            const content = msg.content || msg.contentEn || msg.displayContent || "";
            return `${msg.role}: ${content}`;
          })
          .filter((msg) => msg.trim().length > 0);
        
        if (recentMessages.length > 0) {
          instructions = `${defaultSystemPrompt}\n\nPrevious conversation context:\n${recentMessages.join("\n")}`;
        }
      }

      const sessionConfig = {
        instructions,
        temperature: 0.8,
        turn_detection: {
          type: "server_vad",
          threshold: 0.75, // Higher threshold = less sensitive to background noise (0.0-1.0) - increased for better noise filtering
          prefix_padding_ms: 300,
          silence_duration_ms: 0, // Reduced to 300ms for lower latency - faster response time
        },
      };

      // Step 1.10: Send offer to server
      console.log("[Voice Chat] 📤 Sending SDP offer to server...");
      console.log("[Voice Chat] 📤 SDP offer length:", finalSdp.length);
      let offerResponse;
      try {
        const offerStartTime = Date.now();
        offerResponse = await fetch("/api/assistant/voice/offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sdp: finalSdp,
            instructions: sessionConfig.instructions,
            voice: "base",
            category: category,
            question: currentUserMessageRef.current || undefined,
          }),
        });
        const offerDuration = Date.now() - offerStartTime;
        console.log("[Voice Chat] 📥 Offer response received:", {
          status: offerResponse.status,
          statusText: offerResponse.statusText,
          duration: `${offerDuration}ms`,
          headers: Object.fromEntries(offerResponse.headers.entries()),
        });
      } catch (fetchError) {
        console.error("[Voice Chat] ❌ Failed to send offer:", {
          message: fetchError.message,
          name: fetchError.name,
          stack: fetchError.stack,
        });
        throw new Error(`Failed to send offer: ${fetchError.message}`);
      }

      if (!offerResponse.ok) {
        let errorData = {};
        try {
          errorData = await offerResponse.json();
          console.error("[Voice Chat] ❌ Offer API error response (JSON):", errorData);
        } catch (e) {
          const errorText = await offerResponse.text().catch(() => "Unknown error");
          console.error("[Voice Chat] ❌ Offer API error response (text):", errorText.substring(0, 500));
          errorData = { error: errorText.substring(0, 200) };
        }
        
        // Provide more detailed error message
        const errorMessage = errorData.error || errorData.details || `Failed to create session (${offerResponse.status})`;
        const errorCode = errorData.code || null;
        const suggestion = errorData.suggestion || null;
        
        console.error("[Voice Chat] ❌ Offer API error details:", {
          status: offerResponse.status,
          error: errorMessage,
          code: errorCode,
          suggestion: suggestion,
        });
        
        throw new Error(
          errorMessage + 
          (suggestion ? `\n\nSuggestion: ${suggestion}` : '') +
          (errorCode ? `\n\nError code: ${errorCode}` : '')
        );
      }

      const answerSdp = await offerResponse.text();
      console.log("[Voice Chat] ✅ Received SDP answer, length:", answerSdp.length);
      const answer = {
        type: "answer",
        sdp: answerSdp,
      };

      // Step 1.11: Set remote description
      await setRemoteDescription(pc, answer);

      // Step 1.12: Wait for connection (reduced timeout for faster failure detection)
      console.log("[Voice Chat] ⏳ Waiting for WebRTC connection...");
      const connectionStartTime = Date.now();
      console.log("[Voice Chat] Initial connection state:", {
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        signalingState: pc.signalingState,
      });
      
      // Log ICE candidate errors for debugging
      pc.onicecandidateerror = (event) => {
        console.error("[Voice Chat] ❌ ICE candidate error:", {
          errorCode: event.errorCode,
          errorText: event.errorText,
          url: event.url,
          address: event.address,
          port: event.port,
        });
      };
      
      await new Promise((resolve, reject) => {
        const connectionTimeout = 15000; // Reduced from 30s to 15s - most connections establish in 5-10s
        let timeoutId = null;
        
        const checkConnection = () => {
          const elapsed = Date.now() - connectionStartTime;
          const connState = pc.connectionState;
          const iceState = pc.iceConnectionState;
          const signalingState = pc.signalingState;
          
          console.log(`[Voice Chat] 🔄 Connection check (${elapsed}ms):`, {
            connectionState: connState,
            iceConnectionState: iceState,
            signalingState: signalingState,
          });
          
          if (connState === "connected" || iceState === "connected") {
            console.log(`[Voice Chat] ✅ Connection established in ${elapsed}ms!`);
            if (timeoutId) clearTimeout(timeoutId);
            pc.removeEventListener("connectionstatechange", checkConnection);
            pc.removeEventListener("iceconnectionstatechange", checkConnection);
            resolve();
          } else if (connState === "failed" || iceState === "failed") {
            console.error(`[Voice Chat] ❌ Connection failed after ${elapsed}ms:`, {
              connectionState: connState,
              iceConnectionState: iceState,
              signalingState: signalingState,
            });
            if (timeoutId) clearTimeout(timeoutId);
            pc.removeEventListener("connectionstatechange", checkConnection);
            pc.removeEventListener("iceconnectionstatechange", checkConnection);
            reject(new Error(`WebRTC connection failed. State: ${connState}, ICE: ${iceState}, Signaling: ${signalingState}`));
          } else if (connState === "disconnected" || iceState === "disconnected") {
            console.warn(`[Voice Chat] ⚠️ Connection disconnected after ${elapsed}ms:`, {
              connectionState: connState,
              iceConnectionState: iceState,
            });
          }
        };
        
        timeoutId = setTimeout(() => {
          const elapsed = Date.now() - connectionStartTime;
          const finalState = {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            elapsed: elapsed,
          };
          console.error(`[Voice Chat] ❌ Connection timeout after ${connectionTimeout}ms:`, finalState);
          pc.removeEventListener("connectionstatechange", checkConnection);
          pc.removeEventListener("iceconnectionstatechange", checkConnection);
          reject(new Error(`WebRTC connection timeout. Final state: ${JSON.stringify(finalState)}`));
        }, connectionTimeout);
        
        pc.addEventListener("connectionstatechange", checkConnection);
        pc.addEventListener("iceconnectionstatechange", checkConnection);
        
        // Also listen for ICE candidate events to see if candidates are being exchanged
        pc.addEventListener("icecandidate", (event) => {
          if (event.candidate) {
            console.log("[Voice Chat] 🧊 ICE candidate received:", event.candidate.type, event.candidate.candidate.substring(0, 50));
          } else {
            console.log("[Voice Chat] 🧊 ICE candidate gathering complete");
          }
        });
        
        // Check immediately
        checkConnection();
      });

      // Data channel callbacks are already set up earlier (before data channel creation)
      // No need to redefine them here - they're ready to handle incoming messages

      setIsConnected(true);
      setIsConnecting(false);
      retryCountRef.current = 0; // Reset retry count on successful connection
      
      // Monitor connection state for disconnections/failures and retry if needed
      setupConnectionStateMonitoring(pc);
      
      // Generate session ID for this voice chat session
      const generateSessionId = () => {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          return `voice-${crypto.randomUUID()}`;
        }
        return `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      };
      
      if (!sessionId) {
        const newSessionId = generateSessionId();
        setSessionId(newSessionId);
        console.log(`[Voice Chat] 📝 Generated session ID: ${newSessionId}`);
      }

      if (onConnectionChange) {
        onConnectionChange({
          isConnected: true,
          isConnecting: false,
          isRecording: false,
          isPlaying: false,
        });
      }

      // Send greeting when connection is established (only if audio is enabled)
      const sendGreeting = () => {
        if (!hasGreetedRef.current && dataChannelRef.current && dataChannelRef.current.readyState === "open" && enableAudio) {
          hasGreetedRef.current = true;
          
          try {
            // Update session with explicit greeting instruction
            const baseInstructions = systemPrompt || ISHU_VOICE_PROMPT;
            const greetingInstructions = baseInstructions + "\n\nCRITICAL: As soon as the connection is established, you MUST immediately greet the user with a warm, friendly, and professional welcome message. Do NOT wait for the user to speak first. Use voice parameters: [Indian accent, Medium, Mid-range, Warm-Friendly, Medium] \"Hello! I'm ishu, your AI assistant at upGrad School of Technology. How can I help you today?\" This greeting should happen automatically upon connection, before the user says anything. Remember to maintain a balance of being both professional and friendly, keep it child-friendly, and use your Indian English accent.";
            
            console.log("[Voice Chat] 📤 Updating session instructions for greeting...");
            sendSessionUpdate(dataChannelRef.current, {
              instructions: greetingInstructions,
            });
            
            // Then send a trigger message to initiate the greeting response
            setTimeout(() => {
              console.log("[Voice Chat] 📤 Sending greeting trigger...");
              const greetingTrigger = {
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "user",
                  content: "Hello",
                },
              };
              dataChannelRef.current.send(JSON.stringify(greetingTrigger));
            }, 300);
    } catch (error) {
            console.error("[Voice Chat] ❌ Error sending greeting:", error);
          }
        } else if (dataChannelRef.current && dataChannelRef.current.readyState !== "open") {
          // Data channel not ready yet, try again in a bit
          setTimeout(sendGreeting, 300);
        }
      };
      
      // Try to send greeting immediately if data channel is ready, otherwise retry
      if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
        sendGreeting();
      } else {
        // Wait a bit for data channel to open, then try
        setTimeout(sendGreeting, 500);
      }

    } catch (err) {
      console.error("[Voice Chat] ❌ Connection error:", err);
      console.error("[Voice Chat] ❌ Error stack:", err.stack);
      console.error("[Voice Chat] ❌ Error details:", {
        message: err.message,
        name: err.name,
        cause: err.cause,
      });
      
      setError(err.message || "Connection failed");
      setIsConnecting(false);
      setIsConnected(false);

      // Cleanup on error
      if (pcRef.current || streamRef.current) {
        console.log("[Voice Chat] 🧹 Cleaning up connection due to error...");
        cleanupConnection(pcRef.current, streamRef.current, dataChannelRef.current, remoteAudioRef.current);
      }

      // Retry logic with exponential backoff
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current += 1;
        const delay = baseRetryDelay * Math.pow(2, retryCountRef.current - 1);
        console.log(`[Voice Chat] 🔄 Retrying connection in ${delay}ms (attempt ${retryCountRef.current}/${maxRetries})...`);
        
        retryTimeoutRef.current = setTimeout(() => {
          if (connectRef.current) {
            connectRef.current();
          }
        }, delay);
      } else {
        console.error("[Voice Chat] ❌ Max retries reached. Connection failed.");
        retryCountRef.current = 0;
      }

      if (onConnectionChange) {
        onConnectionChange({
          isConnected: false,
          isConnecting: false,
          isRecording: false,
          isPlaying: false,
        });
      }
    }
  }, [isConnecting, isConnected, onConnectionChange, onMessageAdd, systemPrompt, category, conversationHistory, fetchAndSendContext, enableAudio, setupConnectionStateMonitoring]);

  // Store connect function in ref for retry logic
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // COMMENTED OUT: Pre-fetch ICE servers on component mount or hover (for faster connection)
  /* useEffect(() => {
    const prefetchIceServers = async () => {
      if (!iceServersRef.current) {
        try {
          console.log("[Voice Chat] 🔄 Pre-fetching ICE servers...");
          const iceResponse = await fetch("/api/assistant/voice/ice-server");
          if (iceResponse.ok) {
            const iceServersData = await iceResponse.json();
            iceServersRef.current = iceServersData;
            console.log("[Voice Chat] ✅ ICE servers pre-fetched and cached");
          }
        } catch (error) {
          // Silently fail - will fetch on connection
        }
      }
    };
    
    // Pre-fetch on component mount or when preConnect is enabled
    if (preConnect || true) { // Always pre-fetch for faster connections
      prefetchIceServers();
    }
  }, [preConnect]); */

  // Auto-connect when autoConnect or preConnect is enabled
  useEffect(() => {
    if ((autoConnect || preConnect) && !isConnected && !isConnecting && !pcRef.current) {
      console.log("[Voice Chat] 🔄 Auto-connecting...", { autoConnect, preConnect });
      connect();
    }
  }, [autoConnect, preConnect, isConnected, isConnecting, connect]);

  /**
   * Save conversation to database
   */
  const saveConversation = useCallback(async () => {
    const messages = conversationMessagesRef.current;
    if (!sessionId || !messages || messages.length === 0) {
      console.log("[Voice Chat] 💾 No conversation to save (no messages or sessionId)");
      return;
    }

    try {
      // Build exchanges array from messages
      const exchanges = [];
      for (let i = 0; i < messages.length; i += 2) {
        const userMsg = messages[i];
        const assistantMsg = messages[i + 1];
        
        if (userMsg && userMsg.role === "user" && assistantMsg && assistantMsg.role === "assistant") {
          exchanges.push({
            question: userMsg.content || "",
            answer: assistantMsg.content || "",
            createdAt: assistantMsg.createdAt || new Date().toISOString(),
          });
        }
      }

      console.log(`[Voice Chat] 💾 Preparing to save conversation to database...`);

      const response = await fetch("/api/assistant/voice/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content || "",
            createdAt: msg.createdAt || new Date().toISOString(),
          })),
          exchanges,
          source: "voice",
          variant: variant || "widget",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("[Voice Chat] ❌ Failed to save conversation:", errorData);
        return;
      }

      const result = await response.json();
    } catch (error) {
      console.error("[Voice Chat] ❌ Error saving conversation:", error);
      // Don't throw - this is a background operation
    }
  }, [sessionId, variant]);

  /**
   * Disconnect
   */
  const disconnect = useCallback(async () => {
    // Clear any pending retries
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    retryCountRef.current = 0;

    // Remove connection state listeners
    if (pcRef.current) {
      if (connectionStateListenersRef.current.connection) {
        pcRef.current.removeEventListener("connectionstatechange", connectionStateListenersRef.current.connection);
      }
      if (connectionStateListenersRef.current.ice) {
        pcRef.current.removeEventListener("iceconnectionstatechange", connectionStateListenersRef.current.ice);
      }
      connectionStateListenersRef.current.connection = null;
      connectionStateListenersRef.current.ice = null;
    }

    // Get conversation messages before clearing
    const messagesToShow = [...conversationMessagesRef.current];
    
    // Save conversation before disconnecting
    await saveConversation();
    
    if (pcRef.current || streamRef.current) {
      cleanupConnection(pcRef.current, streamRef.current, dataChannelRef.current, remoteAudioRef.current);
    }
    setIsConnected(false);
    setIsConnecting(false);
    setIsRecording(false);
    setIsPlaying(false);
    setError(null);
    pcRef.current = null;
    streamRef.current = null;
    dataChannelRef.current = null;
    currentUserMessageRef.current = "";
    currentAssistantMessageRef.current = "";
    
    // Stop and cleanup speech recognition
    stopInterimSTT();
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.abort();
      } catch (error) {
        // Ignore errors during cleanup
      }
      speechRecognitionRef.current = null;
    }
    setInterimTranscript("");
    
    // Notify parent that conversation ended with all messages (include sessionId)
    if (onConversationEnd && messagesToShow.length > 0) {
      onConversationEnd(messagesToShow, sessionId);
    }
    
    // Reset conversation tracking
    conversationMessagesRef.current = [];
    setConversationMessages([]);
    setSessionId(null);

    if (onConnectionChange) {
      onConnectionChange({
        isConnected: false,
        isConnecting: false,
        isRecording: false,
        isPlaying: false,
      });
    }
  }, [onConnectionChange, saveConversation, onConversationEnd, stopInterimSTT]);

  // COMMENTED OUT: Auto-connect if enabled
  /* useEffect(() => {
    if (autoConnect && !isConnected && !isConnecting) {
      connect();
    } else if (!autoConnect && isConnected) {
      disconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]); */

  // Monitor audio and ensure it stays playing (only if audio is enabled)
  useEffect(() => {
    if (!isConnected || !enableAudio) return;
    
    const audio = remoteAudioRef.current;
    if (!audio) return;
    
    const checkAndResume = () => {
      if (audio.srcObject) {
        const tracks = audio.srcObject.getTracks();
        const activeTracks = tracks.filter(t => t.readyState === 'live' && !t.muted && t.enabled);
        
        if (activeTracks.length > 0 && audio.paused && !audio.ended) {
          audio.play().catch(() => {});
        }
      }
    };
    
    const interval = setInterval(checkAndResume, 1000);
    
    return () => clearInterval(interval);
  }, [isConnected, enableAudio]);
  
  // Update audio muted state when enableAudio changes
  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !enableAudio;
      if (enableAudio && remoteAudioRef.current.paused && remoteAudioRef.current.srcObject) {
        remoteAudioRef.current.play().catch(() => {});
      }
    }
  }, [enableAudio]);

  // Handle microphone when enableAudio changes (but keep connection alive)
  useEffect(() => {
    if (!enableAudio) {
      // Audio disabled - disable microphone tracks but keep connection alive
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => {
            if (track.readyState === 'live') {
              track.enabled = false; // Disable but don't stop (keeps connection alive)
            }
          });
        } catch (error) {
          // Silently handle errors
        }
      }
      
      // Disable tracks from peer connection senders (but don't remove them)
      if (pcRef.current && isConnected) {
        try {
          pcRef.current.getSenders().forEach((sender) => {
            if (sender.track && sender.track.kind === 'audio') {
              sender.track.enabled = false; // Disable but don't stop
            }
          });
        } catch (error) {
          // Silently handle errors
        }
      }
    } else if (enableAudio && isConnected && pcRef.current) {
      // Audio enabled - re-enable microphone if connection exists
      if (streamRef.current) {
        // Re-enable existing tracks
        try {
          streamRef.current.getTracks().forEach((track) => {
            if (track.readyState === 'live') {
              track.enabled = true;
            }
          });
          
          // Re-enable peer connection tracks
          pcRef.current.getSenders().forEach((sender) => {
            if (sender.track && sender.track.kind === 'audio') {
              sender.track.enabled = true;
            }
          });
        } catch (error) {
          console.error("[Voice Chat] Failed to re-enable microphone:", error);
        }
      }
    }
  }, [enableAudio, isConnected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear retry timeout
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      // Remove connection state listeners
      if (pcRef.current) {
        if (connectionStateListenersRef.current.connection) {
          pcRef.current.removeEventListener("connectionstatechange", connectionStateListenersRef.current.connection);
        }
        if (connectionStateListenersRef.current.ice) {
          pcRef.current.removeEventListener("iceconnectionstatechange", connectionStateListenersRef.current.ice);
        }
      }

      // Clear audio check interval
      if (remoteAudioRef.current?._audioCheckInterval) {
        clearInterval(remoteAudioRef.current._audioCheckInterval);
      }
      
      // Cleanup speech recognition
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.abort();
        } catch (error) {
          // Ignore errors during cleanup
        }
        speechRecognitionRef.current = null;
      }
      
      if (pcRef.current || streamRef.current) {
        cleanupConnection(pcRef.current, streamRef.current, dataChannelRef.current, remoteAudioRef.current);
      }
    };
  }, []);

  // Expose connection state - use ref to track previous state and prevent unnecessary calls
  const prevStateRef = useRef({ isConnected, isConnecting, isRecording, isPlaying });
  
  useEffect(() => {
    // Only call onConnectionChange if state actually changed
    const currentState = { isConnected, isConnecting, isRecording, isPlaying };
    const prevState = prevStateRef.current;
    
    const hasChanged = 
      currentState.isConnected !== prevState.isConnected ||
      currentState.isConnecting !== prevState.isConnecting ||
      currentState.isRecording !== prevState.isRecording ||
      currentState.isPlaying !== prevState.isPlaying;
    
    if (hasChanged && onConnectionChange) {
      prevStateRef.current = currentState;
      onConnectionChange(currentState);
    }
  }, [isConnected, isConnecting, isRecording, isPlaying, onConnectionChange]);

  // Expose disconnect method, saveConversation, and getSessionId via ref
  useImperativeHandle(ref, () => ({
    disconnect: async () => {
      await disconnect();
    },
    saveConversation: async () => {
      await saveConversation();
    },
    getSessionId: () => {
      return sessionId;
    },
  }), [disconnect, saveConversation, sessionId]);

  return (
    <div className="hidden">
      {/* Audio Element (hidden) */}
      <audio
        ref={(el) => {
          remoteAudioRef.current = el;
          if (el) {
            el.volume = 1.0;
            el.muted = !enableAudio;
            el.autoplay = enableAudio;
            el.playsInline = true;
          }
        }}
        autoPlay
        playsInline
        onPlay={() => {
          // Track first audio chunk (for LLM inference time calculation)
          if (responseStartedTimeRef.current && !firstAudioChunkTimeRef.current) {
            firstAudioChunkTimeRef.current = Date.now();
            const llmInferenceTime = firstAudioChunkTimeRef.current - responseStartedTimeRef.current;
            
            // ✅ COMPREHENSIVE END-TO-END TIMING BREAKDOWN
            if (processStartTimeRef.current) {
              const totalEndToEndTime = firstAudioChunkTimeRef.current - processStartTimeRef.current;
              const sttTime = sttProcessingTimeRef.current || 0;
              const ragTime = contextFetchDurationRef.current || 0;
              const lunaTime = lunaProcessingTimeRef.current || 0;
              
            console.log(`[Voice Bot Timing] 🔊 First audio chunk received`);
            console.log(`[Voice Bot Timing]    ⏱️  LLM Inference Time: ${llmInferenceTime}ms (response started → first audio)`);
            console.log(`[Voice Bot Timing]    ⚠️  This is another major latency source!`);
              console.log(`[Voice Bot Timing] ⏱️ ========================================`);
              console.log(`[Voice Bot Timing] 📊 COMPLETE END-TO-END LATENCY BREAKDOWN:`);
              console.log(`[Voice Bot Timing] ⏱️ ========================================`);
              if (sttTime > 0) {
                console.log(`[Voice Bot Timing]    ⏱️  STT Processing: ${sttTime}ms (${(sttTime/totalEndToEndTime*100).toFixed(1)}%)`);
              } else {
                console.log(`[Voice Bot Timing]    ⏱️  STT Processing: N/A`);
              }
              if (ragTime > 0) {
                console.log(`[Voice Bot Timing]    ⏱️  RAG Context Fetch: ${ragTime}ms (${(ragTime/totalEndToEndTime*100).toFixed(1)}%)`);
              } else {
                console.log(`[Voice Bot Timing]    ⏱️  RAG Context Fetch: N/A`);
              }
              if (lunaTime > 0) {
                console.log(`[Voice Bot Timing]    ⏱️  Luna AI Processing: ${lunaTime}ms (${(lunaTime/totalEndToEndTime*100).toFixed(1)}%)`);
              } else {
                console.log(`[Voice Bot Timing]    ⏱️  Luna AI Processing: N/A`);
              }
              console.log(`[Voice Bot Timing]    ⏱️  LLM Inference + TTS: ${llmInferenceTime}ms (${(llmInferenceTime/totalEndToEndTime*100).toFixed(1)}%)`);
              
              const otherTime = totalEndToEndTime - (sttTime + ragTime + lunaTime + llmInferenceTime);
              if (otherTime > 0) {
                console.log(`[Voice Bot Timing]    ⏱️  Other/Overhead: ${otherTime}ms (${(otherTime/totalEndToEndTime*100).toFixed(1)}%)`);
              }
              
              console.log(`[Voice Bot Timing]    ⏱️  ─────────────────────────────────`);
              console.log(`[Voice Bot Timing]    ⏱️  TOTAL END-TO-END: ${totalEndToEndTime}ms`);
              
              // ✅ Identify bottlenecks
              const bottlenecks = [];
              if (sttTime > 1000) bottlenecks.push(`STT (${sttTime}ms)`);
              if (lunaTime > 1000) bottlenecks.push(`Luna AI (${lunaTime}ms)`);
              if (llmInferenceTime > 1000) bottlenecks.push(`LLM Inference (${llmInferenceTime}ms)`);
              if (ragTime > 500) bottlenecks.push(`RAG (${ragTime}ms)`);
              
              if (bottlenecks.length > 0) {
                console.log(`[Voice Bot Timing]    ⚠️  BOTTLENECKS: ${bottlenecks.join(', ')}`);
              }
              
              console.log(`[Voice Bot Timing] ⏱️ ========================================`);
              
              // Reset timing refs
              processStartTimeRef.current = null;
              sttProcessingTimeRef.current = null;
              contextFetchDurationRef.current = null;
              lunaProcessingTimeRef.current = null;
            } else {
              // Fallback if processStartTimeRef not set
              console.log(`[Voice Bot Timing] 🔊 First audio chunk received`);
              console.log(`[Voice Bot Timing]    ⏱️  LLM Inference Time: ${llmInferenceTime}ms (response started → first audio)`);
              console.log(`[Voice Bot Timing]    ⚠️  This is another major latency source!`);
              console.log(`[Voice Bot Timing]    ⚠️  End-to-end timing not available (processStartTimeRef not set)`);
            }
            
            responseStartedTimeRef.current = null; // Reset
            firstAudioChunkTimeRef.current = null; // Reset
          }
          
          // Only set playing if we're in an active response
          if (isResponseActiveRef.current) {
            setIsPlaying(true);
          }
        }}
        onPause={() => {
          // Don't set to false if we're still in an active response
          // Only pause if response is truly done
          if (!isResponseActiveRef.current) {
            setIsPlaying(false);
          }
        }}
        onEnded={() => {
          // When audio ends, check if response is still active
          if (!isResponseActiveRef.current) {
            setIsPlaying(false);
          }
        }}
      />
    </div>
  );
});

VoiceChat.displayName = 'VoiceChat';