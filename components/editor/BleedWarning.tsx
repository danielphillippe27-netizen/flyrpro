'use client';

import { AlertCircle } from 'lucide-react';
import type { EditorElement } from '@/lib/editor/types';
import { FLYER_PRINT_CONSTANTS_HALF_LETTER } from '@/lib/flyers/printConstants';

interface BleedWarningProps {
  element: EditorElement;
}

/**
 * BleedWarning Component
 * 
 * Checks if an element extends into the bleed zone and displays a warning.
 */
export function BleedWarning({ element }: BleedWarningProps) {
  const {
    BLEED_INSET,
    TRIM_RECT,
  } = FLYER_PRINT_CONSTANTS_HALF_LETTER;

  // Calculate element bounds
  const elementLeft = element.x;
  const elementRight = element.x + element.width;
  const elementTop = element.y;
  const elementBottom = element.y + element.height;

  // Check if element extends into bleed zone
  const extendsIntoBleed =
    elementLeft < TRIM_RECT.x ||
    elementRight > TRIM_RECT.x + TRIM_RECT.width ||
    elementTop < TRIM_RECT.y ||
    elementBottom > TRIM_RECT.y + TRIM_RECT.height;

  if (!extendsIntoBleed) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-amber-500 text-xs">
      <AlertCircle className="w-4 h-4" />
      <span>Content may be cut off in print</span>
    </div>
  );
}

/**
 * Check if an element extends into bleed zone
 */
export function isElementInBleed(element: EditorElement): boolean {
  const {
    TRIM_RECT,
  } = FLYER_PRINT_CONSTANTS_HALF_LETTER;

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
}

