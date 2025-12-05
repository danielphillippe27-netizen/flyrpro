'use client';

import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { EditorElement } from '@/lib/editor/types';
import { FLYER_PRINT_CONSTANTS_HALF_LETTER } from '@/lib/flyers/printConstants';

interface PrintSafetyIndicatorProps {
  elements: EditorElement[];
}

/**
 * PrintSafetyIndicator Component
 * 
 * Shows green "Print Safe" when all content is within safe zone,
 * red "Risk of Cutoff" when content extends into bleed.
 */
export function PrintSafetyIndicator({ elements }: PrintSafetyIndicatorProps) {
  const {
    SAFE_RECT,
    TRIM_RECT,
  } = FLYER_PRINT_CONSTANTS_HALF_LETTER;

  if (elements.length === 0) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs">
        <CheckCircle2 className="w-4 h-4" />
        <span>Print Safe</span>
      </div>
    );
  }

  // Check if any element extends beyond safe zone
  const hasUnsafeContent = elements.some((element) => {
    const elementLeft = element.x;
    const elementRight = element.x + element.width;
    const elementTop = element.y;
    const elementBottom = element.y + element.height;

    return (
      elementLeft < SAFE_RECT.x ||
      elementRight > SAFE_RECT.x + SAFE_RECT.width ||
      elementTop < SAFE_RECT.y ||
      elementBottom > SAFE_RECT.y + SAFE_RECT.height
    );
  });

  // Check if any element extends into bleed zone
  const hasBleedContent = elements.some((element) => {
    const elementLeft = element.x;
    const elementRight = element.x + element.width;
    const elementTop = element.y;
    const elementBottom = element.y + element.height;

    return (
      elementLeft < TRIM_RECT.x ||
      elementRight > TRIM_RECT.x + TRIM_RECT.width ||
      elementTop < TRIM_RECT.y ||
      elementBottom > TRIM_RECT.y + TRIM_RECT.height
    );
  });

  if (hasBleedContent) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-xs">
        <AlertTriangle className="w-4 h-4" />
        <span>Risk of Cutoff</span>
      </div>
    );
  }

  if (hasUnsafeContent) {
    return (
      <div className="flex items-center gap-2 text-amber-500 text-xs">
        <AlertTriangle className="w-4 h-4" />
        <span>Near Edge</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-green-500 text-xs">
      <CheckCircle2 className="w-4 h-4" />
      <span>Print Safe</span>
    </div>
  );
}

