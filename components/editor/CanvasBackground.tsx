'use client';

import { Rect, Image as KonvaImage } from 'react-konva';
import { useKonvaImage } from '@/lib/hooks/useKonvaImage';
import type { EditorPage } from '@/lib/editor/types';
import { FLYER_PRINT_CONSTANTS_HALF_LETTER } from '@/lib/flyers/printConstants';

interface CanvasBackgroundProps {
  page: EditorPage;
  showBleed?: boolean;
}

export function CanvasBackground({ page, showBleed = false }: CanvasBackgroundProps) {
  const backgroundImage = page.backgroundImageUrl
    ? useKonvaImage(page.backgroundImageUrl)
    : null;

  // Use bleed size when bleed is shown, otherwise use page size
  const bgWidth = showBleed ? FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_WIDTH : page.width;
  const bgHeight = showBleed ? FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_HEIGHT : page.height;
  const bgX = showBleed ? -FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_INSET : 0;
  const bgY = showBleed ? -FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_INSET : 0;

  if (backgroundImage) {
    return (
      <KonvaImage
        x={bgX}
        y={bgY}
        image={backgroundImage}
        width={bgWidth}
        height={bgHeight}
        listening={false}
      />
    );
  }

  return (
    <Rect
      x={bgX}
      y={bgY}
      width={bgWidth}
      height={bgHeight}
      fill={page.backgroundColor}
      listening={false}
    />
  );
}



