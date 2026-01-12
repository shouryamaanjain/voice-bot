/**
 * WebRTC Connection Management
 * 
 * Utilities for managing WebRTC peer connections with LUNA AI.
 * Handles peer connection setup, data channels, and audio tracks.
 */

/**
 * Initialize WebRTC peer connection
 * 
 * @param {Array} iceServers - ICE servers configuration
 * @returns {RTCPeerConnection} Configured peer connection
 */
export function createPeerConnection(iceServers) {
    const pc = new RTCPeerConnection({
      iceServers: iceServers || [
        { urls: "stun:stun.l.google.com:19302" },
      ],
    });
  
    return pc;
  }
  
  /**
   * Setup data channel for event communication
   * 
   * @param {RTCPeerConnection} pc - Peer connection
   * @param {Function} onMessage - Callback for data channel messages
   * @returns {RTCDataChannel} Data channel
   */
  export function setupDataChannel(pc, onMessage) {
    let dataChannel = null;
    
    // Luna AI creates the data channel, so we need to listen for it
    // But also create one as fallback in case they don't
    pc.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannelHandlers(dataChannel, onMessage);
    };
  
    // Also create our own data channel as fallback
    try {
      const ourDataChannel = pc.createDataChannel("events", {
        ordered: true,
      });
      
      // Only use our channel if we don't get one from remote
      if (!dataChannel) {
        dataChannel = ourDataChannel;
        setupDataChannelHandlers(dataChannel, onMessage);
      }
    } catch (error) {
      // Data channel may already exist, ignore
    }
  
    return dataChannel;
  }
  
  function setupDataChannelHandlers(dataChannel, onMessage) {
    dataChannel.onopen = () => {
      // Data channel opened
    };
  
    dataChannel.onclose = () => {
      // Data channel closed
    };
  
    dataChannel.onerror = (error) => {
      // Data channel error - silently handle
    };
  
    dataChannel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (error) {
        // Failed to parse data channel message - silently handle
      }
    };
  }
  
  /**
   * Setup audio tracks for WebRTC
   * 
   * @param {RTCPeerConnection} pc - Peer connection
   * @param {MediaStream} localStream - User's microphone stream
   * @param {HTMLAudioElement} remoteAudio - Audio element for remote audio playback
   */
  // Track processed tracks globally to prevent duplicates across connections
  const processedTracks = new Set();
  
  export function setupAudioTracks(pc, localStream, remoteAudio, enableAudio = true) {
    // Add local audio tracks to peer connection
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }
  
    // Handle remote audio tracks
    const handleTrack = (event) => {
      // Skip if we've already processed this track
      if (processedTracks.has(event.track.id)) {
        return;
      }
      
      // Mark this track as processed
      processedTracks.add(event.track.id);
      
      let remoteStream = null;
      if (event.streams && event.streams.length > 0) {
        remoteStream = event.streams[0];
      } else if (event.track) {
        remoteStream = new MediaStream([event.track]);
      }
      
      if (remoteAudio && remoteStream && event.track.kind === 'audio') {
        // Check if we already have a stream with this track
        if (remoteAudio.srcObject) {
          const existingStream = remoteAudio.srcObject;
          const trackId = event.track.id;
          const alreadyExists = existingStream.getTracks().some(
            existingTrack => existingTrack.id === trackId
          );
          
          if (alreadyExists) {
            return;
          }
          
          // If same stream ID, add track to existing stream
          if (existingStream.id === remoteStream.id) {
            existingStream.addTrack(event.track);
            return; // Don't set up listeners again
          } else {
            // Different stream, stop old tracks and replace
            existingStream.getTracks().forEach(track => track.stop());
          }
        }
        
        // Set up new stream
        remoteAudio.srcObject = remoteStream;
        
        // Set up track event listeners only once per track
        if (!event.track.onunmute) {
          event.track.onunmute = () => {
            if (remoteAudio && remoteAudio.paused) {
              remoteAudio.play().catch(() => {});
            }
          };
        }
        
        if (!event.track.onended) {
          event.track.onended = () => {
            processedTracks.delete(event.track.id);
          };
        }
        
        // Ensure audio is configured correctly (only set once)
        if (!remoteAudio.dataset.configured) {
          remoteAudio.volume = 1.0;
          remoteAudio.muted = !enableAudio; // Mute if audio is disabled
          remoteAudio.autoplay = enableAudio; // Only autoplay if audio is enabled
          remoteAudio.playsInline = true;
          remoteAudio.dataset.configured = 'true';
          
          // Set up audio element event listeners only once
          remoteAudio.oncanplay = () => {
            if (remoteAudio && remoteAudio.paused) {
              remoteAudio.play().catch(() => {});
            }
          };
          
          remoteAudio.onplay = () => {
            // Audio playback started
          };
          
          remoteAudio.onpause = () => {
            // Audio playback paused
          };
          
          remoteAudio.ontimeupdate = () => {
            // Audio playing
          };
        }
        
        // Monitor track state periodically (only for new tracks)
        const checkTrackState = () => {
          if (event.track.readyState === 'live' && !event.track.muted && event.track.enabled) {
            if (remoteAudio && remoteAudio.paused) {
              remoteAudio.play().catch(() => {});
            }
          }
        };
        
        // Check immediately and after delays
        checkTrackState();
        setTimeout(checkTrackState, 1000);
        setTimeout(checkTrackState, 3000);
        
        // Try to play the audio immediately only if audio is enabled
        if (enableAudio) {
          const playPromise = remoteAudio.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                // Audio play() succeeded
              })
              .catch((error) => {
                // If autoplay is blocked, set up user interaction handler
                if (error.name === 'NotAllowedError' || error.name === 'NotSupportedError') {
                  const startPlayback = () => {
                    remoteAudio.play().catch(() => {});
                    document.removeEventListener('click', startPlayback);
                    document.removeEventListener('touchstart', startPlayback);
                  };
                  document.addEventListener('click', startPlayback, { once: true });
                  document.addEventListener('touchstart', startPlayback, { once: true });
                }
              });
          }
        }
      }
    };
    
    // Set up ontrack handler
    pc.ontrack = handleTrack;
  }
  
  /**
   * Create WebRTC offer
   * 
   * @param {RTCPeerConnection} pc - Peer connection
   * @returns {Promise<RTCSessionDescriptionInit>} SDP offer
   */
  export async function createOffer(pc) {
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
  
    await pc.setLocalDescription(offer);
    return offer;
  }
  
  /**
   * Set remote description from answer
   * 
   * @param {RTCPeerConnection} pc - Peer connection
   * @param {RTCSessionDescriptionInit} answer - SDP answer
   */
  export async function setRemoteDescription(pc, answer) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
  
  /**
   * Handle ICE candidate events
   * 
   * @param {RTCPeerConnection} pc - Peer connection
   * @param {Function} onIceCandidate - Callback for ICE candidates
   */
  export function setupIceHandling(pc, onIceCandidate) {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate);
      }
    };
  
    pc.oniceconnectionstatechange = () => {
      // ICE connection state changed
    };
  }
  
  /**
   * Cleanup WebRTC connection
   * 
   * @param {RTCPeerConnection} pc - Peer connection
   * @param {MediaStream} localStream - Local media stream to stop
   * @param {RTCDataChannel} dataChannel - Data channel to close
   * @param {HTMLAudioElement} remoteAudio - Remote audio element to clear (optional)
   */
  export function cleanupConnection(pc, localStream, dataChannel, remoteAudio = null) {
    // Close data channel first
    if (dataChannel) {
      try {
        if (dataChannel.readyState !== "closed") {
          dataChannel.close();
        }
      } catch (error) {
        // Silently handle cleanup errors
      }
    }
  
    // Stop all local media tracks
    if (localStream) {
      try {
        localStream.getTracks().forEach((track) => {
          track.stop(); // This stops the track and releases the microphone
        });
      } catch (error) {
        // Silently handle cleanup errors
      }
    }
  
    // Remove all tracks from peer connection before closing
    if (pc) {
      try {
        // Remove all senders (local tracks)
        pc.getSenders().forEach((sender) => {
          if (sender.track) {
            sender.track.stop();
          }
          pc.removeTrack(sender);
        });
  
        // Close peer connection
        if (pc.connectionState !== "closed") {
          pc.close();
        }
      } catch (error) {
        // Silently handle cleanup errors
      }
    }
  
    // Clear remote audio
    if (remoteAudio) {
      try {
        if (remoteAudio.srcObject) {
          const remoteStream = remoteAudio.srcObject;
          remoteStream.getTracks().forEach((track) => {
            track.stop();
            processedTracks.delete(track.id);
          });
          remoteAudio.srcObject = null;
        }
        remoteAudio.pause();
        remoteAudio.src = "";
        delete remoteAudio.dataset.configured;
      } catch (error) {
        // Silently handle cleanup errors
      }
    }
    
    // Clear all processed tracks on cleanup to allow fresh connections
    processedTracks.clear();
  }
  
  