/**
 * Print Constants for Flyer Editor
 * 
 * All dimensions are in pixels at 300 DPI (print resolution).
 * 
 * Trim size: 8.5" x 11" = 2550 x 3300 px
 * Bleed size: 8.75" x 11.25" = 2625 x 3375 px (0.125" bleed on all sides)
 * Safe area: 8.0" x 10.5" = 2400 x 3150 px (0.25" margin inside trim)
 */

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



