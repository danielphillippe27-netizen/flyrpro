'use client';

import { Rect, Image as KonvaImage } from 'react-konva';
import { useKonvaImage } from '@/lib/hooks/useKonvaImage';
import type { EditorPage } from '@/lib/editor/types';

interface CanvasBackgroundProps {
  page: EditorPage;
}

export function CanvasBackground({ page }: CanvasBackgroundProps) {
  const backgroundImage = page.backgroundImageUrl
    ? useKonvaImage(page.backgroundImageUrl)
    : null;

  if (backgroundImage) {
    return (
      <KonvaImage
        x={0}
        y={0}
        image={backgroundImage}
        width={page.width}
        height={page.height}
        listening={false}
      />
    );
  }

  return (
    <Rect
      x={0}
      y={0}
      width={page.width}
      height={page.height}
      fill={page.backgroundColor}
      listening={false}
    />
  );
}

