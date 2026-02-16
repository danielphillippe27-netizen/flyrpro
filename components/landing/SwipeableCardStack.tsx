'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Image from 'next/image';

export interface SwipeableCardItem {
  src: string;
  alt: string;
}

const SWIPE_THRESHOLD = 60;
const STACK_OFFSET = 12;
const STACK_ROTATION = 4;

export function SwipeableCardStack({ items }: { items: SwipeableCardItem[] }) {
  const [index, setIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const dragOffsetRef = useRef(0);
  dragOffsetRef.current = dragOffset;

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % items.length);
  }, [items.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + items.length) % items.length);
  }, [items.length]);

  const handleStart = useCallback(
    (clientX: number) => {
      startX.current = clientX;
      setIsDragging(true);
      setDragOffset(0);
    },
    []
  );

  const handleMove = useCallback((clientX: number) => {
    setDragOffset(clientX - startX.current);
  }, []);

  const handleEnd = useCallback(() => {
    setIsDragging(false);
    const offset = dragOffsetRef.current;
    if (offset < -SWIPE_THRESHOLD) goNext();
    else if (offset > SWIPE_THRESHOLD) goPrev();
    setDragOffset(0);
  }, [goNext, goPrev]);

  const handleTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX);
  const handleTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX);
  const handleTouchEnd = () => handleEnd();

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStart(e.clientX);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onMouseUp = () => handleEnd();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, handleMove, handleEnd]);

  if (items.length === 0) return null;

  return (
    <div className="relative flex flex-col items-center">
      <div
        className="relative w-full max-w-lg touch-none select-none"
        style={{ minHeight: 600 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
      >
        {/* Stack: render current and next 2 cards with offset/rotation */}
        {[0, 1, 2].map((stackPos) => {
          const itemIndex = (index + stackPos) % items.length;
          const item = items[itemIndex];
          const isTop = stackPos === 0;
          const rotate = isTop
            ? STACK_ROTATION + (dragOffset !== 0 ? (dragOffset / 20) : 0)
            : STACK_ROTATION * (stackPos + 1);
          const x = isTop ? dragOffset : stackPos * STACK_OFFSET;
          const y = stackPos * STACK_OFFSET;
          const scale = 1 - stackPos * 0.04;
          const zIndex = 10 - stackPos;

          return (
            <div
              key={`${itemIndex}-${stackPos}`}
              className="absolute left-1/2 top-0 w-[85%] max-w-[280px] -translate-x-1/2 overflow-hidden rounded-2xl border border-zinc-800 bg-black shadow-xl transition-shadow"
              style={{
                aspectRatio: '9/19',
                transform: `translate(${x}px, ${y}px) translateX(-50%) rotate(${rotate}deg) scale(${scale})`,
                zIndex,
                transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
                boxShadow: isTop ? '0 25px 50px -12px rgba(0,0,0,0.25)' : '0 10px 25px -8px rgba(0,0,0,0.15)',
              }}
            >
              <Image
                src={item.src}
                alt={item.alt}
                fill
                className="object-cover"
                sizes="(max-width: 500px) 92vw, 420px"
                draggable={false}
                priority={stackPos === 0}
                unoptimized
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent) {
                    const fallback = document.createElement('div');
                    fallback.className = 'flex h-full items-center justify-center bg-zinc-800 text-zinc-400 text-sm';
                    fallback.textContent = item.alt || 'Image';
                    parent.appendChild(fallback);
                  }
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Dots */}
      <div className="mt-6 flex gap-2">
        {items.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Go to card ${i + 1}`}
            onClick={() => setIndex(i)}
            className={`h-2 rounded-full transition-all ${
              i === index ? 'w-6 bg-zinc-900' : 'w-2 bg-zinc-300 hover:bg-zinc-400'
            }`}
          />
        ))}
      </div>

      <p className="mt-3 text-center text-sm text-zinc-500">Swipe or drag to browse</p>
    </div>
  );
}

