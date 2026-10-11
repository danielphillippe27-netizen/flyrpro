'use client';

import { useCallback } from 'react';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';

/** Stop gestures before native map/layout listeners can cancel panel scrolling. */
export function useStormPanelScroll() {
  return useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const wheel = (event: WheelEvent) => handleWheelScrollContainer(event, element);
    const touch = (event: TouchEvent) => event.stopPropagation();
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('touchmove', touch, { passive: true });
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('touchmove', touch);
    };
  }, []);
}
