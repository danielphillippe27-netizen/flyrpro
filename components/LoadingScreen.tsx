'use client';

import Lottie from 'lottie-react';
import { useTheme } from '@/lib/theme-provider';
import { useEffect, useMemo, useState } from 'react';

export interface LoadingScreenProps {
  variant?: 'fullScreen' | 'inline' | 'overlay';
  useVideo?: boolean;
  message?: string;
  className?: string;
}

export function LoadingScreen({
  variant = 'fullScreen',
  useVideo = false,
  message,
  className = '',
}: LoadingScreenProps) {
  const { theme } = useTheme();
  const [animationData, setAnimationData] = useState<object | null>(null);

  const isDark = theme === 'dark';
  const lottieSrc = useMemo(
    () => (isDark ? '/loading/white.json' : '/loading/black.json'),
    [isDark]
  );
  const videoSrc = useMemo(
    () => (isDark ? '/loading/White.mp4' : '/loading/Black.mp4'),
    [isDark]
  );

  useEffect(() => {
    if ((variant === 'fullScreen' || variant === 'overlay') && useVideo) return;
    let cancelled = false;
    fetch(lottieSrc)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setAnimationData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lottieSrc, variant, useVideo]);

  const showVideo = (variant === 'fullScreen' || variant === 'overlay') && useVideo;
  const size = variant === 'inline' ? { width: 560, height: 560 } : { width: 160, height: 160 };

  const media = showVideo ? (
    <video
      src={videoSrc}
      autoPlay
      loop
      muted
      playsInline
      className="object-contain"
      style={variant === 'inline' ? { width: 560, height: 560 } : { maxWidth: 280, maxHeight: 280 }}
      aria-hidden
    />
  ) : animationData ? (
    <Lottie
      animationData={animationData}
      loop
      style={size}
      rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
    />
  ) : (
    <div
      className="rounded-full border-4 border-slate-300 border-t-emerald-500 animate-spin"
      style={size}
      aria-hidden
    />
  );

  if (variant === 'inline') {
    return (
      <div
        className={`flex flex-col items-center justify-center ${className}`}
        role="status"
        aria-label={message || 'Loading'}
      >
        <div className="flex items-center justify-center" style={size}>
          {media}
        </div>
        {message && <span className="sr-only">{message}</span>}
      </div>
    );
  }

  if (variant === 'overlay') {
    return (
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center bg-gray-50/95 dark:bg-background/95 z-10 ${className}`}
        role="status"
        aria-label={message || 'Loading'}
      >
        <div className="flex flex-col items-center justify-center">
          {media}
          {message && (
            <p className="mt-4 text-sm text-gray-600 dark:text-foreground/80">
              {message}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-background ${className}`}
      role="status"
      aria-label={message || 'Loading'}
    >
      <div className="flex flex-col items-center justify-center">
        {media}
        {message && (
          <p className="mt-4 text-sm text-gray-600 dark:text-foreground/80">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
