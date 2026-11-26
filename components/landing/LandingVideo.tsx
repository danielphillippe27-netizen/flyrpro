'use client';

import { useEffect, useRef, useState } from 'react';

type LandingVideoProps = {
  videoUrl: string;
  label: string;
  className?: string;
  videoClassName?: string;
};

export function LandingVideo({
  videoUrl,
  label,
  className = '',
  videoClassName = 'object-cover',
}: LandingVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShouldLoad(entry.isIntersecting);
      },
      { rootMargin: '300px 0px' },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative isolate overflow-hidden rounded-[2rem] bg-zinc-950 shadow-2xl shadow-black/20 ${className}`}
    >
      {shouldLoad && (
        <video
          src={videoUrl}
          title={label}
          className={`h-full w-full border-0 ${videoClassName}`}
          autoPlay
          muted
          loop
          playsInline
        />
      )}
    </div>
  );
}
