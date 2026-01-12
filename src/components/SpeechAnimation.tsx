"use client";

import React from 'react';

interface SpeechAnimationProps {
  isDark?: boolean;
  className?: string;
}

export function SpeechAnimation({ isDark = false, className = "" }: SpeechAnimationProps) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div 
        className="w-2 h-2 rounded-full animate-bounce"
        style={{
          backgroundColor: isDark ? 'rgba(239, 68, 68, 0.8)' : 'rgba(220, 38, 38, 0.8)',
          animationDelay: '0ms',
          animationDuration: '1.4s',
        }}
      />
      <div 
        className="w-2 h-2 rounded-full animate-bounce"
        style={{
          backgroundColor: isDark ? 'rgba(239, 68, 68, 0.8)' : 'rgba(220, 38, 38, 0.8)',
          animationDelay: '200ms',
          animationDuration: '1.4s',
        }}
      />
      <div 
        className="w-2 h-2 rounded-full animate-bounce"
        style={{
          backgroundColor: isDark ? 'rgba(239, 68, 68, 0.8)' : 'rgba(220, 38, 38, 0.8)',
          animationDelay: '400ms',
          animationDuration: '1.4s',
        }}
      />
    </div>
  );
}

