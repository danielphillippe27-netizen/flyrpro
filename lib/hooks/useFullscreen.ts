'use client';

import { useState, useEffect, useCallback, type RefObject } from 'react';

function getFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  return (
    document.fullscreenElement ??
    (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ??
    null
  );
}

/**
 * Hook for toggling browser fullscreen on a target element.
 * Falls back to document.documentElement when no target is provided.
 * Syncs with fullscreenchange and ESC; safe when API is not supported.
 */
export function useFullscreen(targetRef?: RefObject<HTMLElement | null>) {
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const handler = () => {
      const fullscreenElement = getFullscreenElement();
      if (!targetRef?.current) {
        setIsFs(Boolean(fullscreenElement));
        return;
      }
      setIsFs(fullscreenElement === targetRef.current);
    };

    handler();
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  const enter = useCallback(async () => {
    try {
      const el = targetRef?.current ?? document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if ((el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
        await (el as HTMLElement & { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen();
      }
    } catch {
      // No-op if not supported or denied (e.g. not from user gesture in some browsers)
    }
  }, [targetRef]);

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
    if (getFullscreenElement()) {
      await exit();
    } else {
      await enter();
    }
  }, [enter, exit]);

  return { isFullscreen: isFs, enter, exit, toggle };
}
