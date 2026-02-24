'use client';

import { useState, useEffect, useCallback } from 'react';

function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  return !!(
    document.fullscreenElement ??
    (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
  );
}

/**
 * Hook for toggling browser fullscreen on document.documentElement.
 * Syncs with fullscreenchange and ESC; safe when API is not supported.
 */
export function useFullscreen() {
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const handler = () => setIsFs(isFullscreen());
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  const enter = useCallback(async () => {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if ((el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
        await (el as HTMLElement & { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen();
      }
    } catch {
      // No-op if not supported or denied (e.g. not from user gesture in some browsers)
    }
  }, []);

  const exit = useCallback(async () => {
    try {
      const doc = document;
      if (doc.exitFullscreen) {
        await doc.exitFullscreen();
      } else if ((doc as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen) {
        await (doc as Document & { webkitExitFullscreen: () => Promise<void> }).webkitExitFullscreen();
      }
    } catch {
      // No-op
    }
  }, []);

  const toggle = useCallback(async () => {
    if (isFullscreen()) {
      await exit();
    } else {
      await enter();
    }
  }, [enter, exit]);

  return { isFullscreen: isFs, enter, exit, toggle };
}
