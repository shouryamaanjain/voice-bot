"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { VoiceChatWindow } from "@/components/VoiceChatWindow";

// Lazy load heavy components - only load after page is interactive
const FloatingAiAssistant = dynamic(() => import("@/components/ui/glowing-ai-chat-assistant").then(mod => ({ default: mod.FloatingAiAssistant })), { ssr: false });
const ConditionalAnimatedRobot = dynamic(() => import("@/components/ConditionalAnimatedRobot"), { ssr: false });

export default function ClientOnlyLazyComponents() {
  const [isVoiceWindowOpen, setIsVoiceWindowOpen] = useState(false);
  const [user, setUser] = useState(null);

  // Fetch user data
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (!response.ok) return;
        const userData = await response.json();
        setUser(userData?.user ?? null);
      } catch (error) {
        // User not logged in or error fetching
        console.log('User not logged in');
      }
    };
    fetchUser();
  }, []);


  // Voice window event listeners
  useEffect(() => {
    // Guard against SSR
    if (typeof window === 'undefined') return;
    
    const handleOpenVoiceWindow = () => {
      console.log('[ClientOnlyLazyComponents] 🎤 openVoiceChatWindow event received');
      setIsVoiceWindowOpen(true);
      console.log('[ClientOnlyLazyComponents] ✅ Voice window state set to open');
    };

    const handleCloseVoiceWindow = () => {
      console.log('[ClientOnlyLazyComponents] 🎤 closeVoiceChatWindow event received');
      setIsVoiceWindowOpen(false);
    };

    window.addEventListener('openVoiceChatWindow', handleOpenVoiceWindow);
    window.addEventListener('closeVoiceChatWindow', handleCloseVoiceWindow);

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('openVoiceChatWindow', handleOpenVoiceWindow);
        window.removeEventListener('closeVoiceChatWindow', handleCloseVoiceWindow);
      }
    };
  }, []);

  return (
    <>
      <FloatingAiAssistant />
      <ConditionalAnimatedRobot />
      <VoiceChatWindow 
        isOpen={isVoiceWindowOpen} 
        onClose={() => {
          setIsVoiceWindowOpen(false);
          if (typeof window !== 'undefined') {
            const event = new CustomEvent('closeVoiceChatWindow');
            window.dispatchEvent(event);
          }
        }}
        user={user}
      />
    </>
  );
}

