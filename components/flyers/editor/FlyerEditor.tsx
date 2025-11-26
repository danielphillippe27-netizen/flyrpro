'use client';

import { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useFlyerEditorStore } from './useFlyerEditorStore';
import { FLYER_PRINT_CONSTANTS } from '@/lib/flyers/printConstants';
import { Toolbar } from './Toolbar';
import { PropertiesPanel } from './PropertiesPanel';
import type { FlyerElement, FlyerTextElement, FlyerImageElement, FlyerQRElement } from '@/lib/flyers/types';
import { useKonvaImage } from '@/lib/hooks/useKonvaImage';
import { useQrImage } from '@/lib/hooks/useQrImage';

interface FlyerEditorProps {
  campaignId: string;
  flyerId: string;
}

export function FlyerEditor({ campaignId, flyerId }: FlyerEditorProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const {
    flyerData,
    selectedElementId,
    setSelectedElementId,
    updateElement,
    deleteElement,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useFlyerEditorStore();

  // Calculate scale to fit viewport
  useEffect(() => {
    if (!containerRef.current) return;

    const updateScale = () => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const padding = 40;
      const availableWidth = container.clientWidth - padding;
      const availableHeight = container.clientHeight - padding;

      // Base stage size is 1/3 of print size for display
      const baseWidth = FLYER_PRINT_CONSTANTS.PRINT_WIDTH / 3;
      const baseHeight = FLYER_PRINT_CONSTANTS.PRINT_HEIGHT / 3;

      const scaleX = availableWidth / baseWidth;
      const scaleY = availableHeight / baseHeight;
      const newScale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 1

      setScale(newScale);
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Update transformer when selection changes
  useEffect(() => {
    if (!transformerRef.current) return;

    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!stage) return;

    const selectedNode = stage.findOne(`#${selectedElementId}`);
    if (selectedNode) {
      transformer.nodes([selectedNode]);
      transformer.getLayer()?.batchDraw();
    } else {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
    }
  }, [selectedElementId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementId) {
          e.preventDefault();
          deleteElement(selectedElementId);
        }
        return;
      }

      // Undo/Redo
      if (cmdOrCtrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) undo();
        return;
      }
      if ((cmdOrCtrl && e.key === 'z' && e.shiftKey) || (cmdOrCtrl && e.key === 'y')) {
        e.preventDefault();
        if (canRedo()) redo();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId, deleteElement, undo, redo, canUndo, canRedo]);

  const baseWidth = FLYER_PRINT_CONSTANTS.PRINT_WIDTH / 3;
  const baseHeight = FLYER_PRINT_CONSTANTS.PRINT_HEIGHT / 3;

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Deselect when clicking on empty area
    if (e.target === e.target.getStage()) {
      setSelectedElementId(null);
    }
  };

  const handleExport = () => {
    const stage = stageRef.current;
    if (!stage) return;

    // Hide guides and transformer
    const guidesLayer = stage.findOne('#guides-layer');
    const transformerLayer = stage.findOne('#transformer-layer');
    
    const guidesVisible = guidesLayer?.visible();
    const transformerVisible = transformerLayer?.visible();

    if (guidesLayer) guidesLayer.visible(false);
    if (transformerLayer) transformerLayer.visible(false);

    stage.batchDraw();

    // Export with pixelRatio 3 to get 2625x3375 from 875x1125 base
    const dataUrl = stage.toDataURL({
      pixelRatio: 3,
      mimeType: 'image/png',
    });

    // Restore visibility
    if (guidesLayer) guidesLayer.visible(guidesVisible ?? true);
    if (transformerLayer) transformerLayer.visible(transformerVisible ?? true);

    stage.batchDraw();

    // Download
    const link = document.createElement('a');
    link.download = `flyer-${flyerId}-export.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex overflow-hidden">
      <Toolbar campaignId={campaignId} flyerId={flyerId} onExport={handleExport} />

      <div ref={containerRef} className="flex-1 flex items-center justify-center p-4 overflow-auto">
        <div className="bg-white rounded-lg shadow-2xl p-4">
          <Stage
            ref={stageRef}
            width={baseWidth * scale}
            height={baseHeight * scale}
            scaleX={scale}
            scaleY={scale}
            onClick={handleStageClick}
            onTap={handleStageClick}
          >
            {/* Guides Layer */}
            <Layer id="guides-layer" listening={false}>
              {/* Bleed area (outer boundary) */}
              <Rect
                x={0}
                y={0}
                width={FLYER_PRINT_CONSTANTS.PRINT_WIDTH}
                height={FLYER_PRINT_CONSTANTS.PRINT_HEIGHT}
                stroke="#ef4444"
                strokeWidth={2}
                fill="transparent"
                opacity={0.3}
              />
              {/* Trim area */}
              <Rect
                x={FLYER_PRINT_CONSTANTS.TRIM_RECT.x}
                y={FLYER_PRINT_CONSTANTS.TRIM_RECT.y}
                width={FLYER_PRINT_CONSTANTS.TRIM_RECT.width}
                height={FLYER_PRINT_CONSTANTS.TRIM_RECT.height}
                stroke="#6b7280"
                strokeWidth={1}
                dash={[5, 5]}
                fill="transparent"
                opacity={0.5}
              />
              {/* Safe area */}
              <Rect
                x={FLYER_PRINT_CONSTANTS.SAFE_RECT.x}
                y={FLYER_PRINT_CONSTANTS.SAFE_RECT.y}
                width={FLYER_PRINT_CONSTANTS.SAFE_RECT.width}
                height={FLYER_PRINT_CONSTANTS.SAFE_RECT.height}
                stroke="#10b981"
                strokeWidth={1}
                fill="transparent"
                opacity={0.4}
              />
            </Layer>

            {/* Background Layer */}
            <Layer id="background-layer" listening={false}>
              <Rect
                x={0}
                y={0}
                width={FLYER_PRINT_CONSTANTS.PRINT_WIDTH}
                height={FLYER_PRINT_CONSTANTS.PRINT_HEIGHT}
                fill={flyerData.backgroundColor}
              />
            </Layer>

            {/* Elements Layer */}
            <Layer id="elements-layer">
              {flyerData.elements.map((element) => (
                <ElementRenderer
                  key={element.id}
                  element={element}
                  isSelected={element.id === selectedElementId}
                  onSelect={() => setSelectedElementId(element.id)}
                  onUpdate={(updates) => updateElement(element.id, updates)}
                />
              ))}
            </Layer>

            {/* Transformer Layer */}
            <Layer id="transformer-layer">
              <Transformer
                ref={transformerRef}
                boundBoxFunc={(oldBox, newBox) => {
                  // Constrain to safe area with small buffer
                  const minX = FLYER_PRINT_CONSTANTS.SAFE_RECT.x - 10;
                  const minY = FLYER_PRINT_CONSTANTS.SAFE_RECT.y - 10;
                  const maxX = FLYER_PRINT_CONSTANTS.SAFE_RECT.x + FLYER_PRINT_CONSTANTS.SAFE_RECT.width + 10;
                  const maxY = FLYER_PRINT_CONSTANTS.SAFE_RECT.y + FLYER_PRINT_CONSTANTS.SAFE_RECT.height + 10;

                  if (newBox.x < minX) {
                    newBox.width -= minX - newBox.x;
                    newBox.x = minX;
                  }
                  if (newBox.y < minY) {
                    newBox.height -= minY - newBox.y;
                    newBox.y = minY;
                  }
                  if (newBox.x + newBox.width > maxX) {
                    newBox.width = maxX - newBox.x;
                  }
                  if (newBox.y + newBox.height > maxY) {
                    newBox.height = maxY - newBox.y;
                  }

                  return newBox;
                }}
              />
            </Layer>
          </Stage>
        </div>
      </div>

      <PropertiesPanel />
    </div>
  );
}

interface ElementRendererProps {
  element: FlyerElement;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<FlyerElement>) => void;
}

function ElementRenderer({ element, isSelected, onSelect, onUpdate }: ElementRendererProps) {
  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const newX = node.x();
    const newY = node.y();

    // Constrain to safe area
    const minX = FLYER_PRINT_CONSTANTS.SAFE_RECT.x;
    const minY = FLYER_PRINT_CONSTANTS.SAFE_RECT.y;
    const maxX = FLYER_PRINT_CONSTANTS.SAFE_RECT.x + FLYER_PRINT_CONSTANTS.SAFE_RECT.width;
    const maxY = FLYER_PRINT_CONSTANTS.SAFE_RECT.y + FLYER_PRINT_CONSTANTS.SAFE_RECT.height;

    let constrainedX = newX;
    let constrainedY = newY;

    if (element.type === 'qr') {
      const size = element.size;
      if (newX < minX) constrainedX = minX;
      if (newY < minY) constrainedY = minY;
      if (newX + size > maxX) constrainedX = maxX - size;
      if (newY + size > maxY) constrainedY = maxY - size;
    } else {
      const width = element.width;
      const height = element.height;
      if (newX < minX) constrainedX = minX;
      if (newY < minY) constrainedY = minY;
      if (newX + width > maxX) constrainedX = maxX - width;
      if (newY + height > maxY) constrainedY = maxY - height;
    }

    node.position({ x: constrainedX, y: constrainedY });
    onUpdate({ x: constrainedX, y: constrainedY });
  };

  const commonProps = {
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    draggable: true,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: handleDragEnd,
  };

  switch (element.type) {
    case 'text': {
      const textEl = element as FlyerTextElement;
      return (
        <Text
          {...commonProps}
          text={textEl.text}
          fontSize={textEl.fontSize}
          fontFamily={textEl.fontFamily || 'Arial'}
          fontStyle={textEl.fontWeight === 'bold' ? 'bold' : 'normal'}
          fill={textEl.fill}
          width={textEl.width}
          height={textEl.height}
          align={textEl.align || 'left'}
          verticalAlign="top"
          wrap="word"
          stroke={isSelected ? '#3b82f6' : undefined}
          strokeWidth={isSelected ? 2 : 0}
        />
      );
    }

    case 'image': {
      const imageEl = element as FlyerImageElement;
      return <ImageElementRenderer element={imageEl} {...commonProps} isSelected={isSelected} />;
    }

    case 'qr': {
      const qrEl = element as FlyerQRElement;
      return <QRElementRenderer element={qrEl} {...commonProps} isSelected={isSelected} />;
    }

    default:
      return null;
  }
}

function ImageElementRenderer({
  element,
  isSelected,
  ...props
}: {
  element: FlyerImageElement;
  isSelected: boolean;
  [key: string]: unknown;
}) {
  const image = useKonvaImage(element.imageUrl);

  if (!image) return null;

  const { objectFit = 'contain' } = element;
  const imageAspect = image.width / image.height;
  const boxAspect = element.width / element.height;

  let drawWidth = element.width;
  let drawHeight = element.height;
  let drawX = 0;
  let drawY = 0;

  if (objectFit === 'contain') {
    if (imageAspect > boxAspect) {
      drawHeight = element.width / imageAspect;
      drawY = (element.height - drawHeight) / 2;
    } else {
      drawWidth = element.height * imageAspect;
      drawX = (element.width - drawWidth) / 2;
    }
  }

  return (
    <Group {...props} id={element.id}>
      <KonvaImage
        image={image}
        x={drawX}
        y={drawY}
        width={drawWidth}
        height={drawHeight}
        listening={false}
      />
      {isSelected && (
        <Rect
          x={0}
          y={0}
          width={element.width}
          height={element.height}
          stroke="#3b82f6"
          strokeWidth={2}
          listening={false}
        />
      )}
    </Group>
  );
}

function QRElementRenderer({
  element,
  isSelected,
  ...props
}: {
  element: FlyerQRElement;
  isSelected: boolean;
  [key: string]: unknown;
}) {
  const qrImage = useQrImage(element.url, element.size);

  if (!qrImage) return null;

  return (
    <Group {...props} id={element.id}>
      <KonvaImage
        image={qrImage}
        x={0}
        y={0}
        width={element.size}
        height={element.size}
        listening={false}
      />
      {isSelected && (
        <Rect
          x={0}
          y={0}
          width={element.size}
          height={element.size}
          stroke="#3b82f6"
          strokeWidth={2}
          listening={false}
        />
      )}
    </Group>
  );
}

