"use client";

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SmokeOverlayProps {
  isVisible: boolean;
  onComplete?: () => void;
}

export function SmokeOverlay({ isVisible, onComplete }: SmokeOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isExitingRef = useRef(false);
  const [hasParticles, setHasParticles] = React.useState(false);
  const timeRef = useRef(0);
  const particlesRef = useRef<Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    opacity: number;
    life: number;
    rotation: number;
    rotationSpeed: number;
    turbulence: number;
    exitVx?: number;
    exitVy?: number;
  }>>([]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!isVisible && particlesRef.current.length > 0) {
      // Start exit animation - smoke disperses outward
      isExitingRef.current = true;
      particlesRef.current.forEach((particle) => {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const angle = Math.atan2(particle.y - centerY, particle.x - centerX);
        const speed = 3 + Math.random() * 4;
        particle.exitVx = Math.cos(angle) * speed;
        particle.exitVy = Math.sin(angle) * speed;
      });
      
      // Continue exit animation
      const animateExit = () => {
        if (!ctx) return;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        particlesRef.current.forEach((particle) => {
          if (particle.exitVx !== undefined && particle.exitVy !== undefined) {
            particle.x += particle.exitVx;
            particle.y += particle.exitVy;
            particle.opacity *= 0.95;
            particle.size *= 1.05;
            particle.rotation += particle.rotationSpeed;
          }

          if (particle.opacity > 0.01) {
            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation);
            
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, particle.size);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${particle.opacity * 0.6})`);
            gradient.addColorStop(0.3, `rgba(220, 220, 220, ${particle.opacity * 0.4})`);
            gradient.addColorStop(0.6, `rgba(180, 180, 180, ${particle.opacity * 0.2})`);
            gradient.addColorStop(1, 'transparent');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.ellipse(0, 0, particle.size, particle.size * 0.7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        });

        if (particlesRef.current.some(p => p.opacity > 0.01)) {
          animationFrameRef.current = requestAnimationFrame(animateExit);
        } else {
          particlesRef.current = [];
          setHasParticles(false);
        }
      };
      
      animateExit();
      return;
    }

    if (!isVisible) return;

    isExitingRef.current = false;
    timeRef.current = 0;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initialize realistic smoke particles - rising and swirling, less dense, faster movement
    const initParticles = () => {
      particlesRef.current = [];
      for (let i = 0; i < 35; i++) {
        const baseY = canvas.height + Math.random() * 200; // Start from bottom
        particlesRef.current.push({
          x: Math.random() * canvas.width,
          y: baseY,
          vx: (Math.random() - 0.5) * 1.2, // Faster horizontal drift
          vy: -1.5 - Math.random() * 1.0, // Faster rising upward (negative)
          size: Math.random() * 120 + 80,
          opacity: Math.random() * 0.15 + 0.1,
          life: 1,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.04, // Faster rotation
          turbulence: Math.random() * Math.PI * 2,
        });
      }
      setHasParticles(true);
    };
    initParticles();

    // Realistic smoke animation loop
    const animate = () => {
      if (!ctx || !isVisible || isExitingRef.current) return;

      timeRef.current += 0.02; // Faster time progression

      // Clear with fade trail
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Update and draw particles
      particlesRef.current.forEach((particle, index) => {
        // Add more turbulence for faster, more noticeable smoke movement
        const turbulenceX = Math.sin(timeRef.current * 3 + particle.turbulence) * 0.6;
        const turbulenceY = Math.cos(timeRef.current * 2.5 + particle.turbulence) * 0.5;
        
        // Update position with turbulence
        particle.x += particle.vx + turbulenceX;
        particle.y += particle.vy + turbulenceY;
        particle.rotation += particle.rotationSpeed;
        
        // Gradually increase size as smoke rises (like real smoke expands)
        particle.size += 0.25; // Slightly faster expansion
        
        // Gradually fade as it rises
        if (particle.y < canvas.height * 0.3) {
          particle.opacity *= 0.998;
        }

        // Reset particle if it goes off screen
        if (particle.y < -particle.size || particle.x < -particle.size || particle.x > canvas.width + particle.size) {
          particle.x = Math.random() * canvas.width;
          particle.y = canvas.height + Math.random() * 100;
          particle.size = Math.random() * 120 + 80;
          particle.opacity = Math.random() * 0.15 + 0.1;
          particle.rotation = Math.random() * Math.PI * 2;
          particle.turbulence = Math.random() * Math.PI * 2;
        }

        // Draw realistic smoke particle with elliptical shape
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        
        // Create realistic smoke gradient
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, particle.size);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${particle.opacity * 0.8})`);
        gradient.addColorStop(0.2, `rgba(240, 240, 240, ${particle.opacity * 0.6})`);
        gradient.addColorStop(0.4, `rgba(200, 200, 200, ${particle.opacity * 0.4})`);
        gradient.addColorStop(0.6, `rgba(160, 160, 160, ${particle.opacity * 0.25})`);
        gradient.addColorStop(0.8, `rgba(120, 120, 120, ${particle.opacity * 0.1})`);
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        // Elliptical shape for more realistic smoke
        ctx.ellipse(0, 0, particle.size, particle.size * 0.75, particle.rotation * 0.5, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible && onComplete) {
      const timer = setTimeout(() => {
        onComplete();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onComplete]);

  return (
    <AnimatePresence mode="wait">
      {(isVisible || hasParticles) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="fixed inset-0 z-[9999] pointer-events-none"
        >
          {/* Subtle dark overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: isVisible ? 1 : 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
            style={{
              pointerEvents: 'auto',
            }}
          />

          {/* Canvas smoke effect - realistic rising smoke */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            style={{
              mixBlendMode: 'screen',
            }}
          />

          {/* Magical sparkles - enhanced twinkling effect */}
          <div className="absolute inset-0">
            {Array.from({ length: 40 }).map((_, i) => {
              const delay = Math.random() * 3;
              const duration = Math.random() * 2 + 1.5;
              const sparkleSize = Math.random() * 4 + 2;
              return (
                <motion.div
                  key={i}
                  className="absolute rounded-full"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    width: `${sparkleSize}px`,
                    height: `${sparkleSize}px`,
                    background: 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0.8) 30%, transparent 70%)',
                    boxShadow: `
                      0 0 ${sparkleSize * 2}px rgba(255, 255, 255, 0.9),
                      0 0 ${sparkleSize * 4}px rgba(255, 255, 255, 0.6),
                      0 0 ${sparkleSize * 6}px rgba(255, 255, 255, 0.3)
                    `,
                  }}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{
                    opacity: [0, 1, 0.8, 1, 0.6, 1, 0],
                    scale: [0, 1.2, 0.9, 1.1, 0.8, 1, 0],
                    rotate: [0, 180, 360],
                    x: (Math.random() - 0.5) * 150,
                    y: (Math.random() - 0.5) * 150,
                  }}
                  transition={{
                    duration: duration,
                    delay: delay,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    times: [0, 0.2, 0.4, 0.6, 0.8, 0.9, 1],
                  }}
                />
              );
            })}
          </div>

        </motion.div>
      )}
    </AnimatePresence>
  );
}

