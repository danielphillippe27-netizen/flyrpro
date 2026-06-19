import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function getInitialReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function useInitialReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(getInitialReducedMotion);

  useEffect(() => {
    setReducedMotion(getInitialReducedMotion());
  }, []);

  return reducedMotion;
}
