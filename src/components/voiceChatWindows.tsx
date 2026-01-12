"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Mic, MicOff } from 'lucide-react';
import { useTheme } from 'next-themes';
import { VoiceChat } from '@/components/VoiceChat';
import { SpeechAnimation } from '@/components/SpeechAnimation';
import { WaveMotion } from '@/components/WaveMotion';
// import { applyThemeColorsProgressive } from '@/lib/utils/progressiveThemeChange';
import { SmokeOverlay } from '../components/SmokeOverlay';
// import CountryCodeSelect from '@/components/CountryCodeSelect';

// Lead form configuration
const LEAD_CONFIG = {
  leadsApi: "/api/leads",
  emailVerificationApi: "/api/leads/email",
  phoneVerificationApi: "/api/leads/phone",
  requireEmailVerification: process.env.NEXT_PUBLIC_LEADS_REQUIRE_EMAIL_VERIFICATION !== "false",
  requirePhoneVerification: process.env.NEXT_PUBLIC_LEADS_REQUIRE_PHONE_VERIFICATION !== "false",
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[0-9]{10}$/; // Strict 10-digit validation
const VERIFIED_EMAILS_STORAGE_KEY = "verifiedEmails";
const VERIFIED_PHONES_STORAGE_KEY = "verifiedPhones";

// Lead intent detection matchers (same as text chat)
const LEAD_INTENT_MATCHERS = [
  { regex: /(\bugsot\b|\bUGSOT\b|\bug-?sot\b|\bupgrad\s*school\s*of\s*technology\b|\bupgrade\s*school\s*of\s*technology\b)/i, interest: "General Inquiry" },
  { regex: /(\bcourse(s|work)?\b|\bprogram(s)?\b|\bdegree\b)/i, interest: "Courses & Programs" },
  { regex: /(\bfull\s*stack\b|\bmern\b|\bsoftware\s*developer\b)/i, interest: "Full Stack" },
  { regex: /(\bdata\s*(science|analytics)\b)/i, interest: "Data & Analytics" },
  { regex: /(\bai\b|\bartificial intelligence\b|\bmachine learning\b)/i, interest: "AI & ML" },
  { regex: /(\bcyber\s*security\b|\binfosec\b)/i, interest: "Cybersecurity" },
  { regex: /(\bcloud\b|\bdevops\b|\baws\b)/i, interest: "Cloud & DevOps" },
  { regex: /(\bfinance\b|\bloan\b|\bfees?\b|\bscholarship\b|\bcost\b|\bprice\b|\bpayment\b)/i, interest: "Finance & Scholarships" },
  { regex: /(\badmission\b|\bapply\b|\benroll\b|\bcontact\b|\bapplication\b)/i, interest: "Admissions" },
  { regex: /(\bduration\b|\bhow\s+long\b|\btime\s+period\b|\byears?\b|\bmonths?\b)/i, interest: "Course Duration" },
];

interface VoiceChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
  user?: { fullName?: string; email?: string } | null;
}

export function VoiceChatWindow({ isOpen, onClose, user }: VoiceChatWindowProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [mounted, setMounted] = useState(false);

  // Debug: Log when isOpen changes
  useEffect(() => {
    console.log('[VoiceChatWindow] 🪟 isOpen changed:', isOpen);
  }, [isOpen]);
  const [voiceState, setVoiceState] = useState<{
    isConnected: boolean;
    isConnecting: boolean;
    isRecording: boolean;
    isPlaying: boolean;
  }>({
    isConnected: false,
    isConnecting: false,
    isRecording: false,
    isPlaying: false,
  });
  const chatRef = useRef<HTMLDivElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const [showSmokeOverlay, setShowSmokeOverlay] = useState(false);
  const voiceChatDataChannelRef = useRef<RTCDataChannel | null>(null);
  const voiceChatRef = useRef<{ disconnect: () => Promise<void>; saveConversation: () => Promise<void>; getSessionId: () => string | null } | null>(null);
  
  // Lead form state
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [detectedInterest, setDetectedInterest] = useState<string | null>(null);
  const [leadFormSubmitted, setLeadFormSubmitted] = useState(false);
  const [submittedLeadEmail, setSubmittedLeadEmail] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Inject CSS for pulsing glow animation and slide-in animation
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse-glow {
        0%, 100% {
          box-shadow: 0 0 60px rgba(255, 105, 180, 0.5), 0 0 110px rgba(135, 206, 250, 0.4), 0 0 160px rgba(255, 255, 255, 0.3), inset 0 0 40px rgba(255, 255, 255, 0.4);
        }
        50% {
          box-shadow: 0 0 100px rgba(255, 105, 180, 0.9), 0 0 160px rgba(135, 206, 250, 0.8), 0 0 220px rgba(255, 255, 255, 0.6), inset 0 0 60px rgba(255, 255, 255, 0.6);
        }
      }
      @keyframes pulse-halo {
        0%, 100% {
          opacity: 0.8;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.1);
        }
      }
      @keyframes slideInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-pulse-glow {
        animation: pulse-glow 2s ease-in-out infinite;
      }
      .animate-pulse-halo {
        animation: pulse-halo 2s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Color customization handler for voice messages
  const checkColorCustomization = useCallback(async (userMessage: string) => {
    // Check if message contains color-related keywords or hex codes
    const colorKeywords = ['color', 'theme', 'change', 'customize', 'personalize', 'blue', 'red', 'green', 'purple', 'orange', 'yellow', 'pink', 'cyan', 'magenta', 'indigo', 'violet', 'teal', 'coral', 'turquoise'];
    const hasColorKeyword = colorKeywords.some(keyword =>
      userMessage.toLowerCase().includes(keyword.toLowerCase())
    );
    const hasHexCode = /#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})/.test(userMessage);

    if (!hasColorKeyword && !hasHexCode) return false;

    // Stop Luna AI from speaking immediately and prevent any response
    if (voiceChatDataChannelRef.current && voiceChatDataChannelRef.current.readyState === "open") {
      try {
        // Send stop command multiple times to ensure it stops
        const stopMessage = {
          type: "response.stop",
        };
        voiceChatDataChannelRef.current.send(JSON.stringify(stopMessage));
        // Send again after a short delay to ensure it's processed
        setTimeout(() => {
          if (voiceChatDataChannelRef.current && voiceChatDataChannelRef.current.readyState === "open") {
            voiceChatDataChannelRef.current.send(JSON.stringify(stopMessage));
          }
        }, 100);
        // Sent stop command to Luna AI for color change
      } catch (error) {
        // Failed to stop Luna AI response - silently handle
      }
    }

    

    try {
      
      const response = await fetch('/api/colors/customize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });

      
      if (!response.ok) {
        
        let errorMessage = 'Failed to customize colors';
        try {
          const errorResult = await response.json();
          errorMessage = errorResult.error || errorMessage;
        } catch (parseError) {
          
          errorMessage = response.statusText || errorMessage;
        }
        // If color recognition failed, don't trigger color change
        if (errorMessage.includes('not able to recognize') || errorMessage.includes('Could not extract') || errorMessage.includes('Could not identify')) {
          setShowSmokeOverlay(false);
          return false; 
        }
        
        throw new Error(errorMessage);
      }

      const result = await response.json();

      
      setShowSmokeOverlay(true);

  
      await applyThemeColorsProgressive({
        primaryOklch: result.primary.oklch,
        secondaryOklch: result.secondary.oklch,
        onSmokeStart: () => {
          // Smoke already shown
        },
        onSmokeEnd: () => {
          setShowSmokeOverlay(false);
        },
        onCurrentPageComplete: () => {
          
        },
        onBackgroundComplete: () => {
          
        },
      });

      return true;
    } catch (err: any) {
      setShowSmokeOverlay(false);
      return false;
    }
  }, []);

  
  const detectLeadIntent = useCallback((text: string) => {
    if (!text) return null;
    for (const matcher of LEAD_INTENT_MATCHERS) {
      if (matcher.regex.test(text)) {
        return matcher.interest;
      }
    }
    return null;
  }, []);

  
  const handleVoiceMessage = useCallback(async (message: { role: "user" | "assistant"; content: string; type?: string }) => {
    if (message.role === "user" && message.content) {
      // Check for color customization - be more lenient for voice
      const isColorRequest = await checkColorCustomization(message.content);
      if (isColorRequest) {
        // Color request detected in voice, processing
        return;
      }
      
      
    }
    
    
  }, [checkColorCustomization, detectLeadIntent, showLeadForm, leadFormSubmitted]);

  // Handle conversation end - fetch from DB and add all messages to chat window (only current session)
  const handleConversationEnd = useCallback(async (messages: Array<{ role: string; content: string; createdAt?: string; type?: string }>, currentSessionId: string | null) => {
    if (!messages || messages.length === 0) {
      return;
    }

    console.log(`[Voice Chat Window] 📤 Processing ${messages.length} messages from current conversation (sessionId: ${currentSessionId})`);
    
    
    if (!currentSessionId) {
      console.warn(`[Voice Chat Window] ⚠️ No sessionId provided, using current conversation messages only`);
      const event = new CustomEvent('voiceConversationEnd', {
        detail: { messages },
      });
      window.dispatchEvent(event);
      return;
    }

    try {
      
      const response = await fetch(`/api/assistant/voice/fetch?sessionId=${encodeURIComponent(currentSessionId)}`);
      if (response.ok) {
        const data = await response.json();
        console.log(`[Voice Chat Window] 📥 Fetched ${data.conversations?.length || 0} conversations from DB for sessionId: ${currentSessionId}`);
        
        
        const allMessages: Array<{ role: string; content: string; createdAt?: string; type?: string }> = [];
        
        if (data.conversations && Array.isArray(data.conversations) && data.conversations.length > 0) {
          
          const currentConversation = data.conversations.find((conv: any) => conv.sessionId === currentSessionId) || data.conversations[0];
          if (currentConversation && currentConversation.messages && Array.isArray(currentConversation.messages)) {
            allMessages.push(...currentConversation.messages);
            console.log(`[Voice Chat Window] 📊 Found ${allMessages.length} messages in current session from DB`);
          }
        } else {
          
          console.log(`[Voice Chat Window] ℹ️ No conversation found in DB for sessionId, using provided messages`);
          allMessages.push(...messages);
        }
        // Remove duplicates based on content, role, and createdAt
        const uniqueMessages = allMessages.filter((msg, index, self) => 
          index === self.findIndex((m) => 
            m.role === msg.role && 
            m.content === msg.content &&
            m.createdAt === msg.createdAt
          )
        );
        
        
        uniqueMessages.sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeA - timeB;
        });
        
        console.log(`[Voice Chat Window] 📤 Adding ${uniqueMessages.length} unique messages from current session to chat window`);
        
        
        const event = new CustomEvent('voiceConversationEnd', {
          detail: { messages: uniqueMessages },
        });
        window.dispatchEvent(event);
      } else {
       
        console.warn(`[Voice Chat Window] ⚠️ Failed to fetch from DB, using current conversation only`);
        const event = new CustomEvent('voiceConversationEnd', {
          detail: { messages },
        });
        window.dispatchEvent(event);
      }
    } catch (error) {
      console.error(`[Voice Chat Window] ❌ Error fetching conversations:`, error);
      
      const event = new CustomEvent('voiceConversationEnd', {
        detail: { messages },
      });
      window.dispatchEvent(event);
    }
  }, []);

  // Handle connection state changes - memoized to prevent infinite loops
  const handleConnectionChange = useCallback((state: {
    isConnected: boolean;
    isConnecting: boolean;
    isRecording: boolean;
    isPlaying: boolean;
  }) => {
    setVoiceState({
      isConnected: state.isConnected,
      isConnecting: state.isConnecting,
      isRecording: state.isRecording,
      isPlaying: state.isPlaying,
    });
  }, []);

  // Handle data channel ready - memoized to prevent infinite loops
  const handleDataChannelReady = useCallback((channel: RTCDataChannel) => {
    voiceChatDataChannelRef.current = channel;
  }, []);

  // Dispatch voice window state change event
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('voiceWindowStateChange', {
        detail: { isOpen }
      });
      window.dispatchEvent(event);
    }
  }, [isOpen]);

  // When voice window closes: Step 1 - Save conversation, Step 2 - Fetch conversations by user ID
  // Note: We don't disconnect here - connection stays active in background for faster reconnection
  useEffect(() => {
    if (!isOpen) {
      // Window just closed - save conversation but keep connection active in background
      const saveThenFetch = async () => {
        try {
          console.log(`[Voice Chat Window] 🪟 Window closed, saving conversation (connection stays active in background)...`);
          
          // STEP 1: Save the conversation to database (without disconnecting)
          let currentSessionId: string | null = null;
          if (voiceChatRef.current) {
            console.log(`[Voice Chat Window] 💾 STEP 1: Saving conversation to database...`);
            
            // Get sessionId before saving
            currentSessionId = voiceChatRef.current.getSessionId();
            console.log(`[Voice Chat Window] 📝 Current sessionId: ${currentSessionId}`);
            
            // Save conversation without disconnecting (connection stays active in background)
            if (voiceChatRef.current.saveConversation) {
              await voiceChatRef.current.saveConversation();
              console.log(`[Voice Chat Window] ✅ STEP 1: Save completed successfully (connection remains active)`);
            } else {
              // Fallback: if saveConversation not available, use disconnect (but this will break background connection)
              console.log(`[Voice Chat Window] ⚠️ saveConversation not available, using disconnect as fallback`);
              await voiceChatRef.current.disconnect();
              console.log(`[Voice Chat Window] ✅ STEP 1: Save completed via disconnect`);
            }
            
            // Small delay to ensure database write is fully committed
            console.log(`[Voice Chat Window] ⏳ Waiting for database write to commit...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Increased delay to ensure DB write is committed
            console.log(`[Voice Chat Window] ✅ Database write committed`);
          
          // STEP 1.5: Update lead score for any lead associated with this conversation
          // This will find the lead by sessionId and update its score with the complete conversation
          if (currentSessionId) {
            console.log(`[Voice Chat Window] 📊 STEP 1.5: Updating lead score for completed conversation (sessionId: ${currentSessionId})...`);
            try {
              const updateResponse = await fetch('/api/leads/update-score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId: currentSessionId,
                  email: submittedLeadEmail || user?.email || null, // Use submitted email, user email, or null
                }),
              });
              
              if (updateResponse.ok) {
                const updateResult = await updateResponse.json();
                console.log(`[Voice Chat Window] ✅ Lead score updated successfully:`, {
                  leadId: updateResult.leadId,
                  classification: updateResult.leadScore?.classification,
                  confidence: updateResult.leadScore?.confidence,
                });
              } else {
                const errorData = await updateResponse.json().catch(() => ({}));
                // 404 is expected if no lead exists for this session (e.g., user didn't submit form)
                if (updateResponse.status === 404) {
                  console.log(`[Voice Chat Window] ℹ️ No lead found for sessionId ${currentSessionId} - this is normal if no lead form was submitted`);
                } else {
                  console.warn(`[Voice Chat Window] ⚠️ Failed to update lead score:`, updateResponse.status, errorData);
                }
              }
            } catch (updateError) {
              console.error(`[Voice Chat Window] ❌ Error updating lead score:`, updateError);
              // Don't block the flow if score update fails
            }
          } else {
            console.log(`[Voice Chat Window] ℹ️ No sessionId available, skipping lead score update`);
          }
          } else {
            console.warn(`[Voice Chat Window] ⚠️ VoiceChat ref not available, cannot save`);
            return; // Don't fetch if we couldn't save
          }
          
          // STEP 2: Fetch only the current session's conversation (filtered by sessionId and user ID)
          if (!currentSessionId) {
            console.warn(`[Voice Chat Window] ⚠️ No sessionId available, cannot fetch specific session`);
            return;
          }
          
          console.log(`[Voice Chat Window] 📥 STEP 2: Fetching current session conversation (sessionId: ${currentSessionId})...`);
          
          // Fetch only the current session - API will automatically filter by userId (if authenticated) or IP (if not)
          const response = await fetch(`/api/assistant/voice/fetch?sessionId=${encodeURIComponent(currentSessionId)}`);
          console.log(`[Voice Chat Window] 📡 Fetch response status: ${response.status}`);
          if (response.ok) {
            const data = await response.json();
            console.log(`[Voice Chat Window] 📊 Fetch response data:`, {
              status: data.status,
              totalCount: data.totalCount,
              conversationCount: data.conversations?.length || 0,
            });
            
            const conversations = data.conversations || [];
            
            if (conversations.length > 0) {
              console.log(`[Voice Chat Window] 📥 Fetched current session conversation from DB`);
              
              // Get messages from the current session (should be only one conversation)
              const currentConversation = conversations[0];
              const allMessages: Array<{ role: string; content: string; createdAt?: string; type?: string }> = [];
              
              if (currentConversation && currentConversation.messages && Array.isArray(currentConversation.messages)) {
                allMessages.push(...currentConversation.messages);
                console.log(`[Voice Chat Window] 📊 Found ${allMessages.length} messages in current session`);
              }
              
              // Sort by createdAt if available
              allMessages.sort((a, b) => {
                const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return timeA - timeB;
              });
              
              if (allMessages.length > 0) {
                console.log(`[Voice Chat Window] 📤 Opening chat window with ${allMessages.length} messages from current session`);
                
                // First, open the chat window - dispatch with proper event properties
                const openChatEvent = new CustomEvent('openChatbot', {
                  bubbles: true,
                  cancelable: true,
                  detail: { source: 'voiceWindow' } // Add source to identify where it came from
                });
                window.dispatchEvent(openChatEvent);
                console.log(`[Voice Chat Window] 📢 Dispatched openChatbot event`);
                
                // Wait a bit longer to ensure chat window is fully open and rendered
                setTimeout(() => {
                  const event = new CustomEvent('voiceConversationEnd', {
                    detail: { messages: allMessages },
                  });
                  window.dispatchEvent(event);
                  console.log(`[Voice Chat Window] ✅ Added ${allMessages.length} messages from current session to chat window`);
                }, 800); // Increased delay to ensure chat window is fully rendered
              } else {
                // Even if no messages, still open the chat window
                console.log(`[Voice Chat Window] 📤 Opening chat window (no messages to add)`);
                const openChatEvent = new CustomEvent('openChatbot', {
                  bubbles: true,
                  cancelable: true,
                  detail: { source: 'voiceWindow' }
                });
                window.dispatchEvent(openChatEvent);
                console.log(`[Voice Chat Window] 📢 Dispatched openChatbot event`);
              }
            } else {
              console.log(`[Voice Chat Window] ℹ️ No conversations found in DB`);
            }
          } else {
            console.warn(`[Voice Chat Window] ⚠️ Failed to fetch conversations from DB`);
          }
        } catch (error) {
          console.error(`[Voice Chat Window] ❌ Error fetching conversations:`, error);
        }
      };
      
      // Small delay to ensure window close is processed
      const timeoutId = setTimeout(saveThenFetch, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, submittedLeadEmail, user?.email]);

  // Prevent body scroll when voice window is open (only on mobile/smaller screens)
  useEffect(() => {
    if (isOpen) {
      const isDesktop = window.innerWidth >= 1024;
      
      if (!isDesktop) {
        const scrollY = window.scrollY;
        const originalOverflow = document.body.style.overflow;
        const originalPaddingRight = document.body.style.paddingRight;
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        
        document.body.style.overflow = 'hidden';
        if (scrollbarWidth > 0) {
          document.body.style.paddingRight = `${scrollbarWidth}px`;
        }
        
        const mainContainer = document.querySelector('main');
        if (mainContainer) {
          (mainContainer as HTMLElement).style.overflow = 'hidden';
        }
        
        const originalHtmlOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        
        return () => {
          document.body.style.overflow = originalOverflow;
          document.body.style.paddingRight = originalPaddingRight;
          document.documentElement.style.overflow = originalHtmlOverflow;
          window.scrollTo(0, scrollY);
          
          if (mainContainer) {
            (mainContainer as HTMLElement).style.overflow = '';
          }
        };
      }
    }
  }, [isOpen]);

  const positionClass = "bottom-4 right-4 sm:bottom-6 sm:right-6";

  if (!mounted) {
    return null;
  }
  
  // Note: VoiceChat will automatically disconnect when autoConnect becomes false (when isOpen is false)
  // The save-then-fetch useEffect also handles disconnect after saving
  
  return (
    <>
      {/* VoiceChat - Pre-connect in background, enable audio when window opens */}
      {React.createElement(VoiceChat as any, {
        ref: voiceChatRef,
        systemPrompt: "You are Ishu, a professional and friendly AI concierge for upGrad School of Technology. Always maintain a balance of being both professional and friendly. Be warm, approachable, and personable while maintaining professional standards. Keep responses friendly, clear, and appropriate for all ages, including children. Provide detailed, structured answers. You can also change the website's color theme when users request it. You MUST speak with a natural Indian English accent in ALL conversations. NEVER use any 18+ content, inappropriate language, or romantic expressions like kisses.",
        category: "general",
        autoConnect: true, // Keep connection active in background
        preConnect: true, // Pre-connect in background to avoid delay when window opens
        enableAudio: isOpen, // Enable audio/microphone only when window is open (connection stays active in background)
        onConnectionChange: handleConnectionChange,
        onMessageAdd: handleVoiceMessage,
        onConversationEnd: handleConversationEnd,
        onDataChannelReady: handleDataChannelReady,
      })}

      {/* UI Window - only show when isOpen */}
      {isOpen && (
        <>
          {/* Smoke Overlay - Shows during color customization */}
          <SmokeOverlay
            isVisible={showSmokeOverlay}
            onComplete={() => {
              // Optional: callback when smoke clears
            }}
          />
          <div className={`fixed ${positionClass} z-[9999]`}>
            <div
              ref={chatRef}
              data-voice-chat-container
              className={`absolute bottom-4 sm:bottom-6 w-[75vw] max-w-[280px] sm:w-[80vw] sm:max-w-[320px] md:w-[400px] md:max-w-[400px] transition-all duration-300 right-0 sm:right-0 origin-bottom-right`}
              onMouseEnter={() => {
                // Connection is always established on mount, no need to pre-connect
              }}
              style={{
                animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
              }}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => {
                e.stopPropagation();
              }}
              onTouchMove={(e) => {
                e.stopPropagation();
              }}
            >
              <div 
                ref={modalContainerRef}
                className={`relative flex flex-col rounded-2xl sm:rounded-3xl border shadow-2xl backdrop-blur-3xl overflow-hidden max-h-[calc(100vh-120px)] ${
            isDark 
              ? 'bg-gradient-to-br from-zinc-800/80 to-zinc-900/90 border-zinc-500/50' 
              : 'bg-gradient-to-br from-white to-zinc-50 border-zinc-300/50'
          }`}
          onWheel={(e) => {
            e.stopPropagation();
          }}
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 pt-3 sm:pt-4 pb-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className={`text-xs sm:text-sm font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                Voice Chat
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className={`relative flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full transition-all duration-300 group ${
                  isDark 
                    ? 'bg-zinc-800/80 hover:bg-red-600/90 text-zinc-300 hover:text-white border border-zinc-700/50 hover:border-red-600/50' 
                    : 'bg-zinc-100/80 hover:bg-red-600/90 text-zinc-700 hover:text-white border border-zinc-300/50 hover:border-red-600/50'
                }`}
                style={{
                  boxShadow: isDark 
                    ? '0 4px 12px rgba(0, 0, 0, 0.3)' 
                    : '0 4px 12px rgba(0, 0, 0, 0.1)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.1) rotate(90deg)';
                  e.currentTarget.style.boxShadow = isDark 
                    ? '0 6px 20px rgba(220, 38, 38, 0.4)' 
                    : '0 6px 20px rgba(220, 38, 38, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
                  e.currentTarget.style.boxShadow = isDark 
                    ? '0 4px 12px rgba(0, 0, 0, 0.3)' 
                    : '0 4px 12px rgba(0, 0, 0, 0.1)';
                }}
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5 transition-all duration-300" />
              </button>
            </div>
          </div>

          {/* Greeting Screen */}
          <div className="flex flex-col items-center justify-center py-6 sm:py-8 px-4 text-center min-h-[240px] sm:min-h-[280px] relative overflow-hidden">
            {/* Dark background - like the timer image */}
            <div 
              className="absolute inset-0 transition-all duration-500"
              style={{
                background: isDark 
                  ? 'linear-gradient(to bottom, rgba(17, 24, 39, 0.98), rgba(0, 0, 0, 0.99))'
                  : 'linear-gradient(to bottom, rgba(30, 30, 30, 0.98), rgba(20, 20, 20, 0.99))',
              }}
            />
            
            {/* Connection status in main window */}
            <div className="relative z-10 mb-4">
              <span className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-full ${
                voiceState.isConnected
                  ? isDark 
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                    : 'bg-green-100 text-green-700 border border-green-300'
                  : voiceState.isConnecting
                  ? isDark 
                    ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' 
                    : 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                  : isDark 
                    ? 'bg-zinc-800/60 text-zinc-300 border border-zinc-700/50' 
                    : 'bg-zinc-100 text-zinc-700 border border-zinc-300'
              }`}>
                {voiceState.isConnected ? 'Connected' : voiceState.isConnecting ? 'Connecting...' : 'Ready'}
              </span>
            </div>

            {/* Large gradient orb with soft glow - pink to cyan to white gradient */}
            <div className="relative z-10 mb-4 sm:mb-6 flex items-center justify-center" style={{ minHeight: '220px', minWidth: '220px' }}>
              <div className="relative w-[180px] h-[180px] flex items-center justify-center">
                {/* Soft halo glow around the orb - pulses when speaking */}
                <div 
                  className={`absolute w-[160px] h-[160px] rounded-full transition-all duration-500 ${voiceState.isPlaying ? 'animate-pulse-halo' : ''}`}
                  style={{
                    background: voiceState.isPlaying
                      ? 'radial-gradient(circle, rgba(255, 255, 255, 0.25) 0%, rgba(255, 255, 255, 0.15) 30%, transparent 70%)'
                      : 'radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.08) 30%, transparent 70%)',
                    filter: voiceState.isPlaying ? 'blur(25px)' : 'blur(20px)',
                    zIndex: 1,
                  }}
                />
                
                {/* The main gradient orb - pink (top-left) to cyan (top-right) to white (bottom) */}
                <div 
                  className={`absolute w-[180px] h-[180px] rounded-full z-10 transition-all duration-500 ${voiceState.isPlaying ? 'animate-pulse-glow' : ''}`}
                  style={{
                    background: 'radial-gradient(ellipse at 30% 25%, rgba(255, 105, 180, 0.98) 0%, rgba(135, 206, 250, 0.95) 45%, rgba(255, 255, 255, 1) 100%)',
                    boxShadow: voiceState.isPlaying
                      ? '0 0 80px rgba(255, 105, 180, 0.8), 0 0 140px rgba(135, 206, 250, 0.7), 0 0 200px rgba(255, 255, 255, 0.5), inset 0 0 50px rgba(255, 255, 255, 0.5)'
                      : '0 0 60px rgba(255, 105, 180, 0.5), 0 0 110px rgba(135, 206, 250, 0.4), inset 0 0 40px rgba(255, 255, 255, 0.4)',
                    filter: 'blur(0.5px)',
                  }}
                >
                  {/* Inner highlight for depth and luminosity */}
                  <div 
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: 'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.5) 0%, transparent 50%)',
                    }}
                  />
                  {/* Additional soft gradient overlay for smooth transition */}
                  <div 
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: 'radial-gradient(circle at 50% 70%, rgba(255, 255, 255, 0.6) 0%, transparent 40%)',
                    }}
                  />
                </div>
              </div>
            </div>
            
            {/* Intro text */}
            <div className="relative z-10 space-y-3 sm:space-y-4">
              {voiceState.isPlaying ? (
                <p className={`text-xs sm:text-sm leading-relaxed ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                  Ishu is speaking...
                  Ishu is speaking...
                </p>
              ) : (
                <>
                  <p className={`text-sm sm:text-base leading-relaxed max-w-md mx-auto ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    Hi there! Welcome to upGrad School of Technology 🎉
                  </p>
                  <p className={`text-sm sm:text-base leading-relaxed max-w-md mx-auto ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    I&apos;m Ishu, your AI sidekick 👋
                    I&apos;m Ishu, your AI sidekick 👋
                  </p>
                  <p className={`text-xs sm:text-sm leading-relaxed max-w-md mx-auto mt-4 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Start speaking with your query to begin
                  </p>
                </>
              )}
            </div>
          </div>

              {/* Connection status indicator */}
              <div className="px-4 sm:px-6 pb-4 sm:pb-6">
              </div>
            </div>
          </div>
          </div>
        </>
      )}

      {/* Lead Form Modal - DISABLED - Not required in this instance */}
      {false && showLeadForm && (
        <div 
          className="fixed inset-0 z-[10000] flex items-end justify-end p-4 sm:p-6"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          onClick={(e) => {
            // Allow closing by clicking outside
            if (e.target === e.currentTarget) {
              setShowLeadForm(false);
              console.log('[VoiceChatWindow] ❌ Lead form closed by clicking outside');
            }
          }}
        >
          <div 
            className={`relative w-full max-w-md sm:max-w-lg rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto ${
              isDark ? 'bg-zinc-900 border border-zinc-700' : 'bg-white border border-zinc-200'
            }`}
            onClick={(e) => e.stopPropagation()}
            style={{
              animation: 'slideInUp 0.3s ease-out',
            }}
          >
            {/* Header - With close button */}
            <div className={`px-4 sm:px-6 py-3 sm:py-4 border-b sticky top-0 ${isDark ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-white'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h2 className={`text-base sm:text-lg font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Share Your Contact Information
                  </h2>
                  <p className={`text-xs sm:text-sm mt-1 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    {detectedInterest ? `We'd love to help you with ${detectedInterest}` : 'We can help you learn more about our programs'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowLeadForm(false);
                    console.log('[VoiceChatWindow] ❌ Lead form closed by user');
                  }}
                  className={`ml-4 p-1 rounded-lg transition-colors ${
                    isDark 
                      ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200' 
                      : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700'
                  }`}
                  aria-label="Close form"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Lead Form Component */}
            <LeadCaptureFormModal
              defaultInterest={detectedInterest || ""}
              onSuccess={(email: string) => {
                setLeadFormSubmitted(true);
                setSubmittedLeadEmail(email);
                setShowLeadForm(false);
                console.log('[VoiceChatWindow] ✅ Lead form submitted successfully, email:', email);
              }}
              sessionId={voiceChatRef.current?.getSessionId() || null}
              isDark={isDark}
            />
          </div>
        </div>
      )}
    </>
  );
}

// Lead Capture Form Modal Component
interface LeadCaptureFormModalProps {
  defaultInterest: string;
  onSuccess: (email: string) => void;
  sessionId: string | null;
  isDark: boolean;
}

function LeadCaptureFormModal({ defaultInterest, onSuccess, sessionId, isDark }: LeadCaptureFormModalProps) {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    phoneCountryCode: "+91", // Default to India
    interest: defaultInterest ?? "",
  });

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);
  const [emailVerification, setEmailVerification] = useState({
    status: "idle" as "idle" | "pending" | "sent" | "verified" | "error",
    message: null as string | null,
    error: null as string | null,
  });
  const [isEmailVerified, setIsEmailVerified] = useState(!LEAD_CONFIG.requireEmailVerification);
  const [verificationCode, setVerificationCode] = useState("");
  
  // Phone verification state
  const [isSendingPhoneVerification, setIsSendingPhoneVerification] = useState(false);
  const [isCheckingPhoneVerification, setIsCheckingPhoneVerification] = useState(false);
  const [phoneVerification, setPhoneVerification] = useState({
    status: "idle" as "idle" | "pending" | "sent" | "verified" | "error",
    message: null as string | null,
    error: null as string | null,
  });
  const [isPhoneVerified, setIsPhoneVerified] = useState(!LEAD_CONFIG.requirePhoneVerification);
  const [phoneVerificationCode, setPhoneVerificationCode] = useState("");

  const verifiedEmails = useMemo(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const stored = window.localStorage.getItem(VERIFIED_EMAILS_STORAGE_KEY);
      if (!stored) return new Set<string>();
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? new Set(parsed.map((v: string) => v.toLowerCase())) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  }, []);

  const verifiedPhones = useMemo(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const stored = window.localStorage.getItem(VERIFIED_PHONES_STORAGE_KEY);
      if (!stored) return new Set<string>();
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? new Set(parsed.map((v: string) => v.replace(/\D/g, ''))) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));

    if (LEAD_CONFIG.requireEmailVerification && name === "email") {
      const nextEmail = value?.trim().toLowerCase();
      const alreadyVerified = Boolean(nextEmail && verifiedEmails.has(nextEmail));
      setIsEmailVerified(alreadyVerified);
      setEmailVerification({ status: "idle", message: null, error: null });
      setVerificationCode("");
    }
    
    if (LEAD_CONFIG.requirePhoneVerification && name === "phone") {
      const cleanPhone = value?.replace(/\D/g, '');
      const fullPhoneNumber = cleanPhone ? `${form.phoneCountryCode.replace(/\D/g, '')}${cleanPhone}` : '';
      const alreadyVerified = Boolean(fullPhoneNumber && verifiedPhones.has(fullPhoneNumber));
      setIsPhoneVerified(alreadyVerified);
      setPhoneVerification({ status: "idle", message: null, error: null });
      setPhoneVerificationCode("");
    }
    
    if (LEAD_CONFIG.requirePhoneVerification && name === "phoneCountryCode") {
      // Reset verification when country code changes
      setIsPhoneVerified(false);
      setPhoneVerification({ status: "idle", message: null, error: null });
      setPhoneVerificationCode("");
    }
  };

  const validate = () => {
    if (!form.fullName.trim() || !form.email.trim() || !form.phone.trim()) {
      setError("All fields are required.");
      return false;
    }
    if (!emailPattern.test(form.email.trim().toLowerCase())) {
      setError("Invalid email address.");
      return false;
    }
    // Validate phone: should be exactly 10 digits
    const cleanPhone = form.phone.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      setError("Invalid phone number. Please enter a 10-digit number.");
      return false;
    }
    if (LEAD_CONFIG.requireEmailVerification && !isEmailVerified) {
      setError("Please verify your email address before submitting.");
      return false;
    }
    if (LEAD_CONFIG.requirePhoneVerification && !isPhoneVerified) {
      setError("Please verify your phone number before submitting.");
      return false;
    }
    setError(null);
    return true;
  };

  const handleSendVerification = async () => {
    if (!LEAD_CONFIG.requireEmailVerification) return;
    if (!form.email.trim() || !emailPattern.test(form.email.trim().toLowerCase())) {
      setEmailVerification({ status: "error", message: null, error: "Enter a valid email before requesting verification." });
      return;
    }

    const normalizedEmail = form.email.trim().toLowerCase();
    const params = new URLSearchParams({ email: normalizedEmail, sessionId: sessionId || "" });

    try {
      const statusResponse = await fetch(`${LEAD_CONFIG.emailVerificationApi}/status?${params.toString()}`);
      if (statusResponse.ok) {
        const statusResult = await statusResponse.json();
        if (statusResult.status === "verified") {
          setIsEmailVerified(true);
          setEmailVerification({ status: "verified", message: "Email verified. You're all set!", error: null });
          if (typeof window !== "undefined") {
            try {
              const nextSet = new Set(verifiedEmails);
              nextSet.add(normalizedEmail);
              window.localStorage.setItem(VERIFIED_EMAILS_STORAGE_KEY, JSON.stringify(Array.from(nextSet)));
            } catch { }
          }
          return;
        }
      }
    } catch { }

    setIsSendingVerification(true);
    setEmailVerification({ status: "pending", message: null, error: null });
    setVerificationCode("");

    try {
      const response = await fetch(`${LEAD_CONFIG.emailVerificationApi}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, sessionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Failed to send verification email");
      setEmailVerification({
        status: "sent",
        message: "We sent a 4-digit verification code to your inbox. Enter it below to confirm your email.",
        error: null,
      });
    } catch (sendError: any) {
      setEmailVerification({ status: "error", message: null, error: sendError.message ?? "Failed to send verification email." });
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!LEAD_CONFIG.requireEmailVerification) return;
    if (!form.email.trim() || verificationCode.trim().length !== 4) {
      setEmailVerification({ status: "error", message: null, error: "Enter the 4-digit code we emailed you." });
      return;
    }

    setIsCheckingVerification(true);
    try {
      const response = await fetch(`${LEAD_CONFIG.emailVerificationApi}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          sessionId,
          code: verificationCode.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Verification failed");
      if (result.status === "verified" || result.status === "already-verified") {
        setIsEmailVerified(true);
        setEmailVerification({ status: "verified", message: "Email verified. You can now submit the form.", error: null });
        if (typeof window !== "undefined") {
          try {
            const nextSet = new Set(verifiedEmails);
            nextSet.add(form.email.trim().toLowerCase());
            window.localStorage.setItem(VERIFIED_EMAILS_STORAGE_KEY, JSON.stringify(Array.from(nextSet)));
          } catch { }
        }
      } else {
        setEmailVerification({ status: "idle", message: null, error: "Verification code incorrect. Try again." });
      }
    } catch (statusError: any) {
      setEmailVerification({ status: "error", message: null, error: statusError.message ?? "Failed to verify code." });
    } finally {
      setIsCheckingVerification(false);
    }
  };

  const handleSendPhoneVerification = async () => {
    if (!LEAD_CONFIG.requirePhoneVerification) return;
    
    // Get the phone value and clean it - ensure we're working with a string
    const phoneValue = String(form.phone || '').trim();
    let cleanPhone = phoneValue.replace(/\D/g, '');
    
    // Remove country code if it's included in the phone field
    // Check if phone starts with country code digits (e.g., 91 for India)
    const countryCodeDigits = String(form.phoneCountryCode || '+91').replace(/\D/g, '');
    
    // Only remove country code if phone is longer than 10 digits and starts with country code
    if (countryCodeDigits && cleanPhone.length > 10 && cleanPhone.startsWith(countryCodeDigits)) {
      cleanPhone = cleanPhone.slice(countryCodeDigits.length);
    }
    
    // Final validation: must be exactly 10 digits
    if (!cleanPhone || cleanPhone.length !== 10) {
      setPhoneVerification({ 
        status: "error", 
        message: null, 
        error: `Invalid phone number. Please enter a 10-digit number.` 
      });
      return;
    }

    // Combine country code with phone number for OTP sending
    const fullPhoneNumber = `${countryCodeDigits}${cleanPhone}`;
    const params = new URLSearchParams({ phone: fullPhoneNumber, sessionId: sessionId || "" });

    try {
      const statusResponse = await fetch(`${LEAD_CONFIG.phoneVerificationApi}/status?${params.toString()}`);
      if (statusResponse.ok) {
        const statusResult = await statusResponse.json();
        if (statusResult.status === "verified") {
          setIsPhoneVerified(true);
          setPhoneVerification({ status: "verified", message: "Phone verified. You're all set!", error: null });
          if (typeof window !== "undefined") {
            try {
              const nextSet = new Set(verifiedPhones);
              nextSet.add(fullPhoneNumber);
              window.localStorage.setItem(VERIFIED_PHONES_STORAGE_KEY, JSON.stringify(Array.from(nextSet)));
            } catch { }
          }
          return;
        }
      }
    } catch { }

    setIsSendingPhoneVerification(true);
    setPhoneVerification({ status: "pending", message: null, error: null });
    setPhoneVerificationCode("");

    try {
      // Combine country code with phone number (ensure consistent format)
      const countryCodeDigits = String(form.phoneCountryCode || '+91').replace(/\D/g, '');
      const fullPhoneNumber = `${countryCodeDigits}${cleanPhone}`;
      console.log('[Phone Verification] Requesting OTP:', {
        localPhone: cleanPhone,
        countryCode: countryCodeDigits,
        fullPhone: fullPhoneNumber,
        sessionId
      });
      
      const response = await fetch(`${LEAD_CONFIG.phoneVerificationApi}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhoneNumber, sessionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Failed to send OTP");
      setPhoneVerification({
        status: "sent",
        message: "We sent a 4-digit OTP to your phone. Enter it below to confirm your number.",
        error: null,
      });
    } catch (sendError: any) {
      setPhoneVerification({ status: "error", message: null, error: sendError.message ?? "Failed to send OTP." });
    } finally {
      setIsSendingPhoneVerification(false);
    }
  };

  const handleVerifyPhoneCode = async () => {
    if (!LEAD_CONFIG.requirePhoneVerification) return;
    
    if (phoneVerificationCode.trim().length !== 4) {
      setPhoneVerification({ status: "error", message: null, error: "Enter the 4-digit OTP we sent to your phone." });
      return;
    }

    // Get the phone value and clean it - ensure we're working with a string
    const phoneValue = String(form.phone || '').trim();
    let cleanPhone = phoneValue.replace(/\D/g, '');
    
    // Get country code digits
    const countryCodeDigits = String(form.phoneCountryCode || '+91').replace(/\D/g, '');
    
    // Only remove country code if phone is longer than 10 digits and starts with country code
    if (countryCodeDigits && cleanPhone.length > 10 && cleanPhone.startsWith(countryCodeDigits)) {
      cleanPhone = cleanPhone.slice(countryCodeDigits.length);
    }
    
    // Ensure we have exactly 10 digits for the local number
    if (!cleanPhone || cleanPhone.length !== 10) {
      setPhoneVerification({ 
        status: "error", 
        message: null, 
        error: "Invalid phone number. Please enter a 10-digit number." 
      });
      return;
    }

    setIsCheckingPhoneVerification(true);
    try {
      // Combine country code with phone number (same format as request)
      const fullPhoneNumber = `${countryCodeDigits}${cleanPhone}`;
      console.log('[Phone Verification] Verifying OTP:', {
        localPhone: cleanPhone,
        countryCode: countryCodeDigits,
        fullPhone: fullPhoneNumber,
        sessionId
      });
      
      const response = await fetch(`${LEAD_CONFIG.phoneVerificationApi}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: fullPhoneNumber,
          sessionId,
          code: phoneVerificationCode.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Verification failed");
        if (result.status === "verified") {
        setIsPhoneVerified(true);
        setPhoneVerification({ status: "verified", message: "Phone verified. You can now submit the form.", error: null });
        if (typeof window !== "undefined") {
          try {
              const nextSet = new Set(verifiedPhones);
              nextSet.add(fullPhoneNumber);
            window.localStorage.setItem(VERIFIED_PHONES_STORAGE_KEY, JSON.stringify(Array.from(nextSet)));
          } catch { }
        }
      } else {
        setPhoneVerification({ status: "idle", message: null, error: "OTP incorrect. Try again." });
      }
    } catch (statusError: any) {
      setPhoneVerification({ status: "error", message: null, error: statusError.message ?? "Failed to verify OTP." });
    } finally {
      setIsCheckingPhoneVerification(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;

    // Only allow submission if intent was detected (defaultInterest is not empty)
    // This ensures we only push leads when user intent is detected
    if (!defaultInterest || !defaultInterest.trim()) {
      setError("Lead form can only be submitted when user intent is detected.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/leads/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phoneCountryCode + form.phone.trim(),
          phoneCountryCode: form.phoneCountryCode,
          interest: form.interest?.trim() || null,
          source: "voice-chat",
          sessionId,
          metadata: { source: "voice-chat" },
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Lead submission failed");

      setSubmitted(true);
      setIsSubmitting(false);
      setTimeout(() => {
        onSuccess(form.email.trim().toLowerCase());
      }, 1500);
    } catch (submissionError: any) {
      setIsSubmitting(false);
      setError(submissionError.message ?? "Lead submission failed");
    }
  };

  if (submitted) {
    return (
      <div className={`p-6 ${isDark ? 'bg-emerald-500/15 text-emerald-100' : 'bg-emerald-50 text-emerald-800'}`}>
        <p className="text-sm font-medium">Thank you! Your information has been received. We&apos;ll be in touch soon.</p>
      </div>
    );
  }

  return (
    <div className={`p-4 sm:p-6 ${isDark ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900'}`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:gap-4">
        <div>
          <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            Full Name *
          </label>
          <input
            name="fullName"
            type="text"
            value={form.fullName}
            onChange={handleChange}
            placeholder="Enter your full name"
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              isDark
                ? 'border-zinc-700 bg-zinc-800 text-white focus:ring-red-500'
                : 'border-zinc-300 bg-white text-zinc-900 focus:ring-red-500'
            }`}
            required
          />
        </div>
        <div>
          <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            Email *
          </label>
          {LEAD_CONFIG.requireEmailVerification ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="sample@gmail.com"
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 ${
                    isDark
                      ? 'border-zinc-700 bg-zinc-800 text-white focus:ring-red-500'
                      : 'border-zinc-300 bg-white text-zinc-900 focus:ring-red-500'
                  }`}
                  required
                  disabled={isEmailVerified}
                />
                <button
                  type="button"
                  onClick={handleSendVerification}
                  disabled={isSendingVerification || !form.email.trim() || isEmailVerified}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isDark 
                      ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-800' 
                      : 'bg-red-600 hover:bg-red-700 disabled:bg-red-400'
                  }`}
                >
                  {isEmailVerified ? "✓ Verified" : isSendingVerification ? "Sending…" : "Send code"}
                </button>
              </div>
              {isEmailVerified ? (
                <p className="text-xs font-medium text-emerald-400">Email verified. You&apos;re all set!</p>
              ) : emailVerification.error ? (
                <p className="text-xs text-red-400">{emailVerification.error}</p>
              ) : emailVerification.message ? (
                <p className={`text-xs ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>{emailVerification.message}</p>
              ) : null}
              {!isEmailVerified && emailVerification.status !== "idle" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={verificationCode}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
                      setVerificationCode(digits);
                    }}
                    className={`w-24 rounded-lg border px-3 py-2 text-center text-sm focus:outline-none focus:ring-2 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-800 text-white focus:ring-red-500'
                        : 'border-zinc-300 bg-white text-zinc-900 focus:ring-red-500'
                    }`}
                    placeholder="0000"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyCode}
                    disabled={isCheckingVerification || verificationCode.length !== 4}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      isDark 
                        ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-800' 
                        : 'bg-red-600 hover:bg-red-700 disabled:bg-red-400'
                    }`}
                  >
                    {isCheckingVerification ? "Verifying…" : "Verify code"}
                  </button>
                </div>
              ) : null}
              {!isEmailVerified && emailVerification.status === "sent" ? (
                <button
                  type="button"
                  onClick={handleSendVerification}
                  disabled={isSendingVerification}
                  className={`self-start text-xs font-semibold hover:opacity-80 disabled:opacity-60 ${
                    isDark ? 'text-red-400' : 'text-red-600'
                  }`}
                >
                  {isSendingVerification ? "Sending…" : "Resend code"}
                </button>
              ) : null}
            </div>
          ) : (
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="sample@gmail.com"
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                isDark
                  ? 'border-zinc-700 bg-zinc-800 text-white focus:ring-purple-500'
                  : 'border-zinc-300 bg-white text-zinc-900 focus:ring-purple-500'
              }`}
              required
            />
          )}
        </div>
        <div>
          <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            Phone *
          </label>
          {LEAD_CONFIG.requirePhoneVerification ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {/* CountryCodeSelect replaced with simple select - lead form not required */}
                <select
                  value={form.phoneCountryCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, phoneCountryCode: e.target.value }))}
                  disabled={isPhoneVerified}
                  className={`rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 ${isDark ? 'border-zinc-700 bg-zinc-800 text-white' : 'border-zinc-300 bg-white text-zinc-900'} ${isPhoneVerified ? 'opacity-60' : ''}`}
                >
                  <option value="+91">+91 (India)</option>
                  <option value="+1">+1 (US/Canada)</option>
                </select>
                <input
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => {
                    // Only allow digits and limit to 10 digits
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setForm((prev) => ({ ...prev, phone: digits }));
                    // Reset phone verification when phone changes
                    if (LEAD_CONFIG.requirePhoneVerification) {
                      setIsPhoneVerified(false);
                      setPhoneVerification({ status: "idle", message: null, error: null });
                      setPhoneVerificationCode("");
                    }
                  }}
                  placeholder="9876543210"
                  maxLength={10}
                  inputMode="numeric"
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 ${
                    isDark
                      ? 'border-zinc-700 bg-zinc-800 text-white focus:ring-red-500'
                      : 'border-zinc-300 bg-white text-zinc-900 focus:ring-red-500'
                  }`}
                  required
                  disabled={isPhoneVerified}
                />
                <button
                  type="button"
                  onClick={handleSendPhoneVerification}
                  disabled={isSendingPhoneVerification || !form.phone.trim() || isPhoneVerified}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isDark 
                      ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-800' 
                      : 'bg-red-600 hover:bg-red-700 disabled:bg-red-400'
                  }`}
                >
                  {isPhoneVerified ? "✓ Verified" : isSendingPhoneVerification ? "Sending…" : "Send OTP"}
                </button>
              </div>
              {isPhoneVerified ? (
                <p className="text-xs font-medium text-emerald-400">Phone verified. You&apos;re all set!</p>
              ) : phoneVerification.error ? (
                <p className="text-xs text-red-400">{phoneVerification.error}</p>
              ) : phoneVerification.message ? (
                <p className={`text-xs ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>{phoneVerification.message}</p>
              ) : null}
              {!isPhoneVerified && phoneVerification.status !== "idle" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={phoneVerificationCode}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
                      setPhoneVerificationCode(digits);
                    }}
                    className={`w-24 rounded-lg border px-3 py-2 text-center text-sm focus:outline-none focus:ring-2 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-800 text-white focus:ring-red-500'
                        : 'border-zinc-300 bg-white text-zinc-900 focus:ring-red-500'
                    }`}
                    placeholder="0000"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyPhoneCode}
                    disabled={isCheckingPhoneVerification || phoneVerificationCode.length !== 4}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      isDark 
                        ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-800' 
                        : 'bg-red-600 hover:bg-red-700 disabled:bg-red-400'
                    }`}
                  >
                    {isCheckingPhoneVerification ? "Verifying…" : "Verify OTP"}
                  </button>
                </div>
              ) : null}
              {!isPhoneVerified && phoneVerification.status === "sent" ? (
                <button
                  type="button"
                  onClick={handleSendPhoneVerification}
                  disabled={isSendingPhoneVerification}
                  className={`self-start text-xs font-semibold hover:opacity-80 disabled:opacity-60 ${
                    isDark ? 'text-red-400' : 'text-red-600'
                  }`}
                >
                  {isSendingPhoneVerification ? "Sending…" : "Resend OTP"}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {/* CountryCodeSelect replaced with simple select - lead form not required */}
              <select
                value={form.phoneCountryCode}
                onChange={(e) => setForm((prev) => ({ ...prev, phoneCountryCode: e.target.value }))}
                className={`rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${isDark ? 'border-zinc-700 bg-zinc-800 text-white' : 'border-zinc-300 bg-white text-zinc-900'}`}
              >
                <option value="+91">+91 (India)</option>
                <option value="+1">+1 (US/Canada)</option>
              </select>
              <input
                name="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => {
                  // Only allow digits and limit to 10 digits
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setForm((prev) => ({ ...prev, phone: digits }));
                }}
                placeholder="9876543210"
                maxLength={10}
                inputMode="numeric"
                className={`flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  isDark
                    ? 'border-zinc-700 bg-zinc-800 text-white focus:ring-red-500'
                    : 'border-zinc-300 bg-white text-zinc-900 focus:ring-red-500'
                }`}
                required
              />
            </div>
          )}
        </div>
        <div>
          <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            Interest
          </label>
          <input
            name="interest"
            type="text"
            value={form.interest}
            onChange={handleChange}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              isDark
                ? 'border-zinc-700 bg-zinc-800 text-white focus:ring-red-500'
                : 'border-zinc-300 bg-white text-zinc-900 focus:ring-red-500'
            }`}
          />
        </div>
        {error ? (
          <div className={`rounded-lg border px-3 py-2 text-xs ${
            isDark ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-red-300 bg-red-50 text-red-700'
          }`}>
            {error}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="submit"
            disabled={isSubmitting || (LEAD_CONFIG.requireEmailVerification && !isEmailVerified) || (LEAD_CONFIG.requirePhoneVerification && !isPhoneVerified)}
            className={`rounded-lg px-4 sm:px-6 py-2 text-xs sm:text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-70 ${
              isDark 
                ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-800' 
                : 'bg-red-600 hover:bg-red-700 disabled:bg-red-400'
            }`}
          >
            {isSubmitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </form>
    </div>
  );
}