/**
 * QR Defaults
 * 
 * Helper functions for creating default QR elements in flyer designs.
 */

import type { FlyerQRElement } from '@/lib/flyers/types';
import { generateId } from './utils';

/**
 * Create a default QR element for new flyers
 * 
 * This creates a placeholder QR element that will be replaced with
 * unique QR codes for each address at print/export time.
 */
export function createDefaultQRElement(): FlyerQRElement {
  return {
    id: generateId(),
    type: 'qr',
    x: 40,
    y: 40,
    size: 180,
    rotation: 0,
    url: '', // Placeholder - will be replaced with unique URL per address at export time
  };
}




