/**
 * QR Validation
 * 
 * Helper functions for validating QR elements in flyer designs.
 */

import type { FlyerElement } from '@/lib/flyers/types';

/**
 * Check if a flyer design has at least one QR element
 * 
 * @param elements - Array of flyer elements
 * @returns true if at least one element has type 'qr', false otherwise
 */
export function flyerHasQRElement(elements: FlyerElement[]): boolean {
  return elements.some((el) => el.type === 'qr');
}




