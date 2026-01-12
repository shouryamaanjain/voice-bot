"use client";

import React from 'react';

interface WaveMotionProps {
  isDark?: boolean;
  isConnected?: boolean;
  className?: string;
}

export function WaveMotion({ isDark = false, isConnected = false, className = "" }: WaveMotionProps) {
  return (
    <>
      {/* Multiple wave rings that expand outward from the orb - green when connected, red otherwise */}
      <div 
        className="absolute rounded-full border-2 transition-all duration-500"
        style={{
          width: '96px',
          height: '96px',
          left: '0%',
          top: '0%',
          transform: 'translate(-50%, -50%) scale(0.8)',
          borderColor: isConnected
            ? isDark ? 'rgba(74, 222, 128, 0.6)' : 'rgba(34, 197, 94, 0.6)'
            : isDark ? 'rgba(239, 68, 68, 0.6)' : 'rgba(220, 38, 38, 0.6)',
          animation: 'waveExpand 2s ease-out infinite',
        }}
      />
      <div 
        className="absolute rounded-full border-2 transition-all duration-500"
        style={{
          width: '96px',
          height: '96px',
          left: '0%',
          top: '0%',
          transform: 'translate(-50%, -50%) scale(0.8)',
          borderColor: isConnected
            ? isDark ? 'rgba(74, 222, 128, 0.4)' : 'rgba(34, 197, 94, 0.4)'
            : isDark ? 'rgba(239, 68, 68, 0.4)' : 'rgba(220, 38, 38, 0.4)',
          animation: 'waveExpand 2s ease-out infinite 0.5s',
        }}
      />
      <div 
        className="absolute rounded-full border-2 transition-all duration-500"
        style={{
          width: '96px',
          height: '96px',
          left: '0%',
          top: '0%',
          transform: 'translate(-50%, -50%) scale(0.8)',
          borderColor: isConnected
            ? isDark ? 'rgba(74, 222, 128, 0.3)' : 'rgba(34, 197, 94, 0.3)'
            : isDark ? 'rgba(239, 68, 68, 0.3)' : 'rgba(220, 38, 38, 0.3)',
          animation: 'waveExpand 2s ease-out infinite 1s',
        }}
      />
      <div 
        className="absolute rounded-full border-2 transition-all duration-500"
        style={{
          width: '96px',
          height: '96px',
          left: '0%',
          top: '0%',
          transform: 'translate(-50%, -50%) scale(0.8)',
          borderColor: isConnected
            ? isDark ? 'rgba(74, 222, 128, 0.2)' : 'rgba(34, 197, 94, 0.2)'
            : isDark ? 'rgba(239, 68, 68, 0.2)' : 'rgba(220, 38, 38, 0.2)',
          animation: 'waveExpand 2s ease-out infinite 1.5s',
        }}
      />
      </>
    
  );
}
