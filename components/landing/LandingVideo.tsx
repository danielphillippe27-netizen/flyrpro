'use client';

import { useEffect, useRef, useState } from 'react';

type LandingVideoProps = {
  videoId: string;
  label: string;
  className?: string;
  videoClassName?: string;
};

export function LandingVideo({
  videoId,
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

  const playerUrl = `https://iframe.videodelivery.net/${videoId}?autoplay=true&muted=true&loop=true&controls=false&preload=metadata&letterboxColor=transparent`;

  return (
    <div
      ref={containerRef}
      className={`relative isolate overflow-hidden rounded-[2rem] bg-zinc-950 shadow-2xl shadow-black/20 ${className}`}
    >
      {shouldLoad && (
        <iframe
          src={playerUrl}
          title={label}
          className={`h-full w-full border-0 ${videoClassName}`}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
          loading="lazy"
        />
      )}
    </div>
  );
}
