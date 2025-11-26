'use client';

import { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Text, Rect, Image as KonvaImage, Group } from 'react-konva';
import type {
  FlyerTemplate,
  FlyerElement,
  FlyerTextElement,
  FlyerImageElement,
  FlyerQRCodeElement,
  FlyerRectElement,
} from '@/lib/types/flyers';
import { useQrImage } from '@/lib/hooks/useQrImage';
import { useKonvaImage } from '@/lib/hooks/useKonvaImage';

interface FlyerEditorCanvasProps {
  template: FlyerTemplate;
  elements: FlyerElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  onUpdateElement: (updated: FlyerElement) => void;
  stageRef?: React.RefObject<any>;
}

/**
 * Flyer Editor Canvas Component
 * 
 * Renders the flyer template on a Konva canvas with interactive elements.
 * Supports element selection, dragging, and visual feedback.
 */
export function FlyerEditorCanvas({
  template,
  elements,
  selectedElementId,
  onSelectElement,
  onUpdateElement,
  stageRef,
}: FlyerEditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  // Calculate scale based on container width
  useEffect(() => {
    if (!containerRef.current) return;

    const updateScale = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth - 32; // padding
      const maxWidth = 800; // max canvas width
      const targetWidth = Math.min(containerWidth, maxWidth);
      const newScale = targetWidth / template.width;
      setScale(newScale);
      setStageSize({
        width: template.width * newScale,
        height: template.height * newScale,
      });
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [template.width, template.height]);

  // Render a single element
  const renderElement = (element: FlyerElement) => {
    const isSelected = element.id === selectedElementId;
    const commonProps = {
      key: element.id,
      x: element.x,
      y: element.y,
      rotation: element.rotation || 0,
      opacity: element.opacity ?? 1,
      onClick: () => onSelectElement(element.id),
      onTap: () => onSelectElement(element.id),
    };

    switch (element.type) {
      case 'text': {
        const textEl = element as FlyerTextElement;
        return (
          <Text
            {...commonProps}
            text={textEl.text}
            fontSize={textEl.fontSize}
            fontFamily={textEl.fontFamily || 'Arial, sans-serif'}
            fontStyle={textEl.fontWeight === 'bold' ? 'bold' : 'normal'}
            fill={textEl.fill}
            width={textEl.maxWidth}
            align={textEl.align || 'left'}
            verticalAlign="middle"
            stroke={isSelected ? '#3b82f6' : undefined}
            strokeWidth={isSelected ? 2 : 0}
            listening={true}
            draggable={true}
            onDragEnd={(e) => {
              onUpdateElement({
                ...element,
                x: e.target.x(),
                y: e.target.y(),
              });
            }}
          />
        );
      }

      case 'rect': {
        const rectEl = element as FlyerRectElement;
        return (
          <Rect
            {...commonProps}
            width={rectEl.width}
            height={rectEl.height}
            fill={rectEl.fill}
            cornerRadius={rectEl.cornerRadius || 0}
            stroke={isSelected ? '#3b82f6' : undefined}
            strokeWidth={isSelected ? 2 : 0}
            listening={true}
            draggable={true}
            onDragEnd={(e) => {
              onUpdateElement({
                ...element,
                x: e.target.x(),
                y: e.target.y(),
              });
            }}
          />
        );
      }

      case 'image': {
        const imageEl = element as FlyerImageElement;
        return (
          <ImageElement
            key={element.id}
            element={imageEl}
            isSelected={isSelected}
            onSelect={() => onSelectElement(element.id)}
            onUpdate={(updated) => onUpdateElement(updated)}
          />
        );
      }

      case 'qrcode': {
        const qrEl = element as FlyerQRCodeElement;
        return (
          <QRCodeElement
            key={element.id}
            element={qrEl}
            isSelected={isSelected}
            onSelect={() => onSelectElement(element.id)}
            onUpdate={(updated) => onUpdateElement(updated)}
          />
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex items-center justify-center p-4 bg-slate-900 rounded-lg"
    >
      <div
        className="bg-white rounded-lg shadow-2xl"
        style={{
          width: stageSize.width,
          height: stageSize.height,
          maxWidth: '100%',
        }}
      >
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          scaleX={scale}
          scaleY={scale}
        >
          <Layer>
            {/* Background */}
            {template.backgroundImageUrl ? (
              <BackgroundImage
                url={template.backgroundImageUrl}
                width={template.width}
                height={template.height}
              />
            ) : (
              <Rect
                x={0}
                y={0}
                width={template.width}
                height={template.height}
                fill={template.backgroundColor || '#ffffff'}
              />
            )}

            {/* Elements */}
            {elements.map(renderElement)}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

/**
 * Background Image Component
 */
function BackgroundImage({
  url,
  width,
  height,
}: {
  url: string;
  width: number;
  height: number;
}) {
  const image = useKonvaImage(url);
  return (
    <KonvaImage
      x={0}
      y={0}
      image={image}
      width={width}
      height={height}
    />
  );
}

/**
 * Image Element Component
 */
function ImageElement({
  element,
  isSelected,
  onSelect,
  onUpdate,
}: {
  element: FlyerImageElement;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updated: FlyerElement) => void;
}) {
  const image = useKonvaImage(element.url);

  return (
    <Group
      x={element.x}
      y={element.y}
      rotation={element.rotation || 0}
      opacity={element.opacity ?? 1}
      onClick={onSelect}
      onTap={onSelect}
      draggable={true}
      onDragEnd={(e) => {
        onUpdate({
          ...element,
          x: e.target.x(),
          y: e.target.y(),
        });
      }}
    >
      <KonvaImage
        image={image}
        width={element.width}
        height={element.height}
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

/**
 * QR Code Element Component
 */
function QRCodeElement({
  element,
  isSelected,
  onSelect,
  onUpdate,
}: {
  element: FlyerQRCodeElement;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updated: FlyerElement) => void;
}) {
  const qrImage = useQrImage(element.url, element.size);

  return (
    <Group
      x={element.x}
      y={element.y}
      rotation={element.rotation || 0}
      opacity={element.opacity ?? 1}
      onClick={onSelect}
      onTap={onSelect}
      draggable={true}
      onDragEnd={(e) => {
        onUpdate({
          ...element,
          x: e.target.x(),
          y: e.target.y(),
        });
      }}
    >
      {qrImage && (
        <KonvaImage
          image={qrImage}
          width={element.size}
          height={element.size}
        />
      )}
      {isSelected && qrImage && (
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

