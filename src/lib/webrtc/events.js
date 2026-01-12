/**
 * WebRTC Event Handlers
 * 
 * Utilities for handling OpenAI-compatible events from LUNA AI data channel.
 */

/**
 * Parse and handle events from data channel
 * 
 * @param {Object} event - Event data from data channel
 * @param {Object} handlers - Event handler callbacks
 */
export function handleDataChannelEvent(event, handlers = {}) {
  const { type } = event;

  switch (type) {
    case "session.created":
    case "session.updated":
      if (handlers.onSessionUpdate) {
        handlers.onSessionUpdate(event);
      }
      break;

    case "conversation.created":
      // Conversation created - no action needed, just acknowledge
      break;

    case "conversation.item.created":
      // Item created - check if it's a user message or assistant response
      if (event.item?.role === "user" && event.item?.type === "message") {
        // User message created
      } else if (event.item?.role === "assistant" && event.item?.type === "message") {
        // Assistant response started
        if (handlers.onResponseStarted) {
          handlers.onResponseStarted(event);
        }
      }
      break;

    case "input_audio_buffer.speech_started":
      if (handlers.onSpeechStarted) {
        handlers.onSpeechStarted(event);
      }
      break;

    case "input_audio_buffer.speech_stopped":
      if (handlers.onSpeechStopped) {
        handlers.onSpeechStopped(event);
      }
      break;

    case "input_audio_buffer.committed":
      // Audio buffer committed - no action needed
      break;

    case "conversation.item.input_audio_transcription.completed":
      if (handlers.onTranscriptionCompleted) {
        handlers.onTranscriptionCompleted(event);
      }
      break;

    case "response.created":
      // Response created - trigger response started
      if (handlers.onResponseStarted) {
        handlers.onResponseStarted(event);
      }
      break;

    case "response.output_item.added":
      // Output item added - might contain audio or text
      // Check for assistant messages
      // Note: content might be an array that gets populated later, or might be empty initially
      if (event.item && event.item?.role === "assistant" && event.item?.type === "message") {
        // If there's already text content, extract it
        if (event.item?.content && typeof event.item.content === 'string') {
          if (handlers.onResponseTranscript) {
            handlers.onResponseTranscript({
              ...event,
              transcript: event.item.content,
            });
          }
        }
      }
      break;

    case "response.content_part.added":
      // Content part added - might contain text or audio
      // Check for transcript in various possible fields
      const transcript = event.part?.transcript || 
                        event.part?.text || 
                        event.part?.content ||
                        event.part?.delta ||
                        "";
      if (transcript && handlers.onResponseTranscript) {
        handlers.onResponseTranscript({
          ...event,
          transcript: transcript,
        });
      }
      break;

    case "response.audio_transcript.done":
    case "response.audio_transcript.delta":
    case "response.audio_transcript.completed":
      if (handlers.onResponseTranscript) {
        const transcript = event.transcript || event.delta || event.text || "";
        if (transcript) {
          handlers.onResponseTranscript({
            ...event,
            transcript: transcript,
          });
        }
      }
      break;

    case "response.done":
    case "response.completed":
    case "conversation.item.output_audio.completed":
      if (handlers.onResponseDone) {
        handlers.onResponseDone(event);
      }
      break;
    
    case "response.started":
      if (handlers.onResponseStarted) {
        handlers.onResponseStarted(event);
      }
      break;

    case "error":
      if (handlers.onError) {
        handlers.onError(event);
      }
      break;

    default:
      // Silently ignore unknown events instead of logging them
      // Many Luna AI events are informational and don't need handling
      break;
  }
}

/**
 * Send session update to LUNA AI
 * 
 * @param {RTCDataChannel} dataChannel - Data channel
 * @param {Object} sessionConfig - Updated session configuration
 */
export function sendSessionUpdate(dataChannel, sessionConfig) {
  if (dataChannel && dataChannel.readyState === "open") {
    const updateMessage = {
      type: "session.update",
      session: sessionConfig,
    };
    dataChannel.send(JSON.stringify(updateMessage));
  }
}

