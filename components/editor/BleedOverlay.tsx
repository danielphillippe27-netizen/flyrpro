'use client';

import { Rect, Line, Group } from 'react-konva';
import { FLYER_PRINT_CONSTANTS_HALF_LETTER } from '@/lib/flyers/printConstants';

interface BleedOverlayProps {
  showBleed: boolean;
  showSafeZone: boolean;
}

/**
 * BleedOverlay Component
 * 
 * Renders bleed zone, crop marks, and safe zone guides for print-accurate flyer editing.
 * All overlays are non-interactive (listening={false}).
 */
export function BleedOverlay({ showBleed, showSafeZone }: BleedOverlayProps) {
  const {
    BLEED_WIDTH,
    BLEED_HEIGHT,
    BLEED_INSET,
    TRIM_RECT,
    SAFE_RECT,
  } = FLYER_PRINT_CONSTANTS_HALF_LETTER;

  return (
    <Group listening={false}>
      {/* Bleed Zone Overlay (light red fill in outer 38px zone) */}
      {showBleed && (
        <>
          {/* Top bleed zone */}
          <Rect
            x={0}
            y={0}
            width={BLEED_WIDTH}
            height={BLEED_INSET}
            fill="#fee2e2"
            opacity={0.5}
            listening={false}
          />
          {/* Bottom bleed zone */}
          <Rect
            x={0}
            y={BLEED_HEIGHT - BLEED_INSET}
            width={BLEED_WIDTH}
            height={BLEED_INSET}
            fill="#fee2e2"
            opacity={0.5}
            listening={false}
          />
          {/* Left bleed zone */}
          <Rect
            x={0}
            y={BLEED_INSET}
            width={BLEED_INSET}
            height={TRIM_RECT.height}
            fill="#fee2e2"
            opacity={0.5}
            listening={false}
          />
          {/* Right bleed zone */}
          <Rect
            x={BLEED_WIDTH - BLEED_INSET}
            y={BLEED_INSET}
            width={BLEED_INSET}
            height={TRIM_RECT.height}
            fill="#fee2e2"
            opacity={0.5}
            listening={false}
          />
        </>
      )}

      {/* Crop Marks (red dashed lines at trim boundary) */}
      {showBleed && (
        <>
          {/* Top crop marks */}
          <Line
            points={[TRIM_RECT.x, TRIM_RECT.y, TRIM_RECT.x + TRIM_RECT.width, TRIM_RECT.y]}
            stroke="#ef4444"
            strokeWidth={1}
            dash={[5, 5]}
            listening={false}
          />
          {/* Bottom crop marks */}
          <Line
            points={[
              TRIM_RECT.x,
              TRIM_RECT.y + TRIM_RECT.height,
              TRIM_RECT.x + TRIM_RECT.width,
              TRIM_RECT.y + TRIM_RECT.height,
            ]}
            stroke="#ef4444"
            strokeWidth={1}
            dash={[5, 5]}
            listening={false}
          />
          {/* Left crop marks */}
          <Line
            points={[TRIM_RECT.x, TRIM_RECT.y, TRIM_RECT.x, TRIM_RECT.y + TRIM_RECT.height]}
            stroke="#ef4444"
            strokeWidth={1}
            dash={[5, 5]}
            listening={false}
          />
          {/* Right crop marks */}
          <Line
            points={[
              TRIM_RECT.x + TRIM_RECT.width,
              TRIM_RECT.y,
              TRIM_RECT.x + TRIM_RECT.width,
              TRIM_RECT.y + TRIM_RECT.height,
            ]}
            stroke="#ef4444"
            strokeWidth={1}
            dash={[5, 5]}
            listening={false}
          />
        </>
      )}

      {/* Safe Zone Guides (blue dashed lines, 75px inset from trim) */}
      {showSafeZone && (
        <>
          {/* Top safe zone line */}
          <Line
            points={[SAFE_RECT.x, SAFE_RECT.y, SAFE_RECT.x + SAFE_RECT.width, SAFE_RECT.y]}
            stroke="#3b82f6"
            strokeWidth={1}
            dash={[4, 4]}
            listening={false}
          />
          {/* Bottom safe zone line */}
          <Line
            points={[
              SAFE_RECT.x,
              SAFE_RECT.y + SAFE_RECT.height,
              SAFE_RECT.x + SAFE_RECT.width,
              SAFE_RECT.y + SAFE_RECT.height,
            ]}
            stroke="#3b82f6"
            strokeWidth={1}
            dash={[4, 4]}
            listening={false}
          />
          {/* Left safe zone line */}
          <Line
            points={[SAFE_RECT.x, SAFE_RECT.y, SAFE_RECT.x, SAFE_RECT.y + SAFE_RECT.height]}
            stroke="#3b82f6"
            strokeWidth={1}
            dash={[4, 4]}
            listening={false}
          />
          {/* Right safe zone line */}
          <Line
            points={[
              SAFE_RECT.x + SAFE_RECT.width,
              SAFE_RECT.y,
              SAFE_RECT.x + SAFE_RECT.width,
              SAFE_RECT.y + SAFE_RECT.height,
            ]}
            stroke="#3b82f6"
            strokeWidth={1}
            dash={[4, 4]}
            listening={false}
          />
        </>
      )}
    </Group>
  );
}

