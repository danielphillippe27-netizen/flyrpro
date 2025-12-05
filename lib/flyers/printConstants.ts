/**
 * Print Constants for Flyer Editor
 * 
 * All dimensions are in pixels at 300 DPI (print resolution).
 * 
 * Letter size: 8.5" x 11" = 2550 x 3300 px
 * Half-letter size: 8.5" x 5.5" = 2550 x 1650 px
 */

// Letter size (8.5" x 11") constants
export const PRINT_WIDTH = 2625; // 8.75" @ 300 DPI (bleed size)
export const PRINT_HEIGHT = 3375; // 11.25" @ 300 DPI (bleed size)

export const BLEED_INSET = 37.5; // 0.125" @ 300 DPI
export const SAFE_INSET = 112.5; // 0.375" @ 300 DPI (bleed + 0.25" margin)

export const TRIM_WIDTH = 2550; // 8.5" @ 300 DPI
export const TRIM_HEIGHT = 3300; // 11" @ 300 DPI

export const SAFE_WIDTH = 2400; // 8.0" @ 300 DPI
export const SAFE_HEIGHT = 3150; // 10.5" @ 300 DPI

export const FLYER_PRINT_CONSTANTS = {
  PRINT_WIDTH,
  PRINT_HEIGHT,
  BLEED_INSET,
  SAFE_INSET,
  TRIM_WIDTH,
  TRIM_HEIGHT,
  SAFE_WIDTH,
  SAFE_HEIGHT,
  TRIM_RECT: {
    x: BLEED_INSET,
    y: BLEED_INSET,
    width: TRIM_WIDTH,
    height: TRIM_HEIGHT,
  },
  SAFE_RECT: {
    x: SAFE_INSET,
    y: SAFE_INSET,
    width: SAFE_WIDTH,
    height: SAFE_HEIGHT,
  },
} as const;

// Half-letter size (8.5" x 5.5") constants
export const HALF_LETTER_TRIM_WIDTH = 2550; // 8.5" @ 300 DPI
export const HALF_LETTER_TRIM_HEIGHT = 1650; // 5.5" @ 300 DPI

export const HALF_LETTER_BLEED_INSET = 38; // 0.125" @ 300 DPI (rounded)
export const HALF_LETTER_BLEED_WIDTH = 2626; // 8.5" + 2×0.125" @ 300 DPI
export const HALF_LETTER_BLEED_HEIGHT = 1726; // 5.5" + 2×0.125" @ 300 DPI

export const HALF_LETTER_SAFE_INSET = 75; // 0.25" @ 300 DPI (from trim edge)
export const HALF_LETTER_SAFE_WIDTH = 2400; // 8.5" - 2×0.25" @ 300 DPI
export const HALF_LETTER_SAFE_HEIGHT = 1500; // 5.5" - 2×0.25" @ 300 DPI

export const FLYER_PRINT_CONSTANTS_HALF_LETTER = {
  // Trim size (final printed size)
  TRIM_WIDTH: HALF_LETTER_TRIM_WIDTH,
  TRIM_HEIGHT: HALF_LETTER_TRIM_HEIGHT,
  
  // Bleed size (full canvas with bleed)
  BLEED_WIDTH: HALF_LETTER_BLEED_WIDTH,
  BLEED_HEIGHT: HALF_LETTER_BLEED_HEIGHT,
  BLEED_INSET: HALF_LETTER_BLEED_INSET,
  
  // Safe zone (recommended content area)
  SAFE_WIDTH: HALF_LETTER_SAFE_WIDTH,
  SAFE_HEIGHT: HALF_LETTER_SAFE_HEIGHT,
  SAFE_INSET: HALF_LETTER_SAFE_INSET,
  
  // Rectangles for easy rendering
  TRIM_RECT: {
    x: HALF_LETTER_BLEED_INSET,
    y: HALF_LETTER_BLEED_INSET,
    width: HALF_LETTER_TRIM_WIDTH,
    height: HALF_LETTER_TRIM_HEIGHT,
  },
  SAFE_RECT: {
    x: HALF_LETTER_BLEED_INSET + HALF_LETTER_SAFE_INSET,
    y: HALF_LETTER_BLEED_INSET + HALF_LETTER_SAFE_INSET,
    width: HALF_LETTER_SAFE_WIDTH,
    height: HALF_LETTER_SAFE_HEIGHT,
  },
} as const;



