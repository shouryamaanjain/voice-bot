"use client";

import { useState, useEffect } from 'react';
import { Mic } from 'lucide-react';
import { VoiceChatWindow } from './voiceChatWindows';

export default function VoiceChatWrapper() {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <>
      {/* Floating Voice Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 hover:scale-110 active:scale-95"
          aria-label="Open voice chat"
        >
          <Mic className="h-6 w-6" />
        </button>
      )}

      {/* Voice Chat Window */}
      <VoiceChatWindow
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        user={null}
      />
    </>
  );
}
