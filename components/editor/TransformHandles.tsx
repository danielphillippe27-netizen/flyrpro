'use client';

import { useEffect, useRef } from 'react';
import { Transformer } from 'react-konva';
import type Konva from 'konva';
import { useEditorStore } from '@/lib/editor/state';
import type { EditorElement } from '@/lib/editor/types';

interface TransformHandlesProps {
  selectedIds: string[];
  elements: Record<string, EditorElement>;
}

export function TransformHandles({ selectedIds, elements }: TransformHandlesProps) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const { updateElement, pushHistory } = useEditorStore();

  // Get selected elements
  const selectedElements = selectedIds
    .map((id) => elements[id])
    .filter((el): el is EditorElement => el !== undefined && !el.locked);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer || selectedElements.length === 0) return;

    // Get Konva nodes for selected elements
    const stage = transformer.getStage();
    if (!stage) return;

    const nodes: Konva.Node[] = [];
    selectedElements.forEach((element) => {
      const node = stage.findOne(`#${element.id}`);
      if (node) {
        nodes.push(node);
      }
    });

    if (nodes.length > 0) {
      transformer.nodes(nodes);
      transformer.getLayer()?.batchDraw();
    }
  }, [selectedElements, selectedIds]);

  const handleTransformEnd = () => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const nodes = transformer.nodes();
    nodes.forEach((node) => {
      const elementId = node.id();
      const element = elements[elementId];
      if (!element || element.locked) return;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      // Reset scale and update width/height
      node.scaleX(1);
      node.scaleY(1);

      const newWidth = Math.max(5, element.width * scaleX);
      const newHeight = Math.max(5, element.height * scaleY);

      updateElement(elementId, {
        x: node.x(),
        y: node.y(),
        width: newWidth,
        height: newHeight,
        rotation: node.rotation(),
      });
    });

    pushHistory();
  };

  if (selectedElements.length === 0) return null;

  return (
    <Transformer
      ref={transformerRef}
      boundBoxFunc={(oldBox, newBox) => {
        // Limit minimum size
        if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
          return oldBox;
        }
        return newBox;
      }}
      onTransformEnd={handleTransformEnd}
      rotateEnabled={true}
      enabledAnchors={[
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
        'top-center',
        'bottom-center',
        'left-center',
        'right-center',
      ]}
      borderEnabled={true}
      borderStroke="#3b82f6"
      borderStrokeWidth={2}
      anchorFill="#3b82f6"
      anchorStroke="#ffffff"
      anchorStrokeWidth={2}
      anchorSize={8}
    />
  );
}



