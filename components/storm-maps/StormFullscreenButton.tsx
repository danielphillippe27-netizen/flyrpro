'use client';

import { useEffect, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import { Maximize, Minimize } from 'lucide-react';
import { useFullscreen } from '@/lib/hooks/useFullscreen';

export function StormFullscreenButton({ map }: { map: mapboxgl.Map }) {
  const target = useRef<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { isFullscreen, toggle } = useFullscreen(target);

  useEffect(() => {
    // Include the storm controls as well as the canvas in the fullscreen surface.
    let surface = map.getContainer().parentElement;
    while (surface && !surface.contains(button.current)) surface = surface.parentElement;
    target.current = surface;
    surface?.classList.add('storm-fullscreen-surface');
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.resize());
    };
    document.addEventListener('fullscreenchange', resize);
    document.addEventListener('webkitfullscreenchange', resize);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('fullscreenchange', resize);
      document.removeEventListener('webkitfullscreenchange', resize);
      window.removeEventListener('resize', resize);
      surface?.classList.remove('storm-fullscreen-surface');
      target.current = null;
    };
  }, [map]);

  return <button ref={button} type="button" aria-label={isFullscreen ? 'Exit fullscreen map' : 'Enter fullscreen map'} onClick={() => void toggle()} className="hidden rounded-full bg-white/10 p-2 md:block">
    {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
  </button>;
}
