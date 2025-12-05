'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Text, Rect, Circle, Image as KonvaImage, Group, Line } from 'react-konva';
import type Konva from 'konva';
import { useEditorStore } from '@/lib/editor/state';
import type { EditorElement, TextElement, RectElement, CircleElement, ImageElement, QRElement, GroupElement } from '@/lib/editor/types';
import { CanvasBackground } from './CanvasBackground';
import { TransformHandles } from './TransformHandles';
import { BleedOverlay } from './BleedOverlay';
import { FLYER_PRINT_CONSTANTS_HALF_LETTER } from '@/lib/flyers/printConstants';
import { useKonvaImage } from '@/lib/hooks/useKonvaImage';
import { useQrImage } from '@/lib/hooks/useQrImage';
import { calculateSnap, getElementBounds } from '@/lib/editor/utils';
import { stageToPage, pageToStage, getElementAtPoint } from '@/lib/editor/konvaHelpers';

interface CanvasStageProps {
  containerRef: React.RefObject<HTMLDivElement>;
  stageRef?: React.RefObject<Konva.Stage>;
}

export function CanvasStage({ containerRef, stageRef: externalStageRef }: CanvasStageProps) {
  const internalStageRef = useRef<Konva.Stage>(null);
  const stageRef = externalStageRef || internalStageRef;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [snapGuides, setSnapGuides] = useState<Array<{ type: 'vertical' | 'horizontal'; position: number }>>([]);
  const [spacePressed, setSpacePressed] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  
  const {
    pages,
    currentPageId,
    elements,
    selectedIds,
    zoom,
    panX,
    panY,
    isDraggingCanvas,
    showBleed,
    showSafeZone,
    setSelectedIds,
    selectSingle,
    toggleSelect,
    clearSelection,
    updateElement,
    setPan,
    startCanvasPan,
    endCanvasPan,
  } = useEditorStore();

  const page = pages[currentPageId];
  if (!page) return null;

  // Get elements in z-order
  const orderedElements = page.elementIds
    .map((id) => elements[id])
    .filter((el): el is EditorElement => el !== undefined && el.visible);

  // Handle wheel zoom
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - panX) / oldScale,
      y: (pointer.y - panY) / oldScale,
    };

    const newScale = e.evt.deltaY > 0 ? oldScale * 0.95 : oldScale * 1.05;
    const clampedScale = Math.max(0.1, Math.min(4, newScale));

    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    };

    useEditorStore.getState().setZoom(clampedScale);
    useEditorStore.getState().setPan(newPos.x, newPos.y);
  }, [zoom, panX, panY]);

  // Handle stage click
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;

    // Don't select if clicking on transformer
    if (e.target.getType() === 'Transformer') return;

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    const pagePos = stageToPage(pointerPos.x, pointerPos.y, zoom, panX, panY);
    const clickedElement = getElementAtPoint(
      pagePos.x,
      pagePos.y,
      Object.values(elements),
      page.elementIds
    );

    if (clickedElement) {
      if (e.evt.shiftKey) {
        toggleSelect(clickedElement.id);
      } else {
        selectSingle(clickedElement.id);
      }
    } else {
      clearSelection();
    }
  }, [zoom, panX, panY, orderedElements, page.elementIds, selectSingle, toggleSelect, clearSelection]);

  // Handle element drag
  const handleElementDrag = useCallback((element: EditorElement) => {
    return (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const newX = node.x();
      const newY = node.y();

      // Calculate snap
      const snapResult = calculateSnap(
        newX,
        newY,
        element.width,
        element.height,
        page,
        elements,
        [element.id],
        8
      );

      setSnapGuides(snapResult.guides);

      // Update element position
      updateElement(element.id, {
        x: snapResult.x,
        y: snapResult.y,
      });

      // Update node position to snapped position
      node.position({ x: snapResult.x, y: snapResult.y });
    };
  }, [page, elements, updateElement]);

  const handleElementDragEnd = useCallback(() => {
    setSnapGuides([]);
    useEditorStore.getState().pushHistory();
  }, []);

  // Handle canvas pan
  const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || e.evt.button === 2 || (e.evt.button === 0 && spacePressed)) {
      e.evt.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.evt.clientX - panX, y: e.evt.clientY - panY });
      startCanvasPan();
    }
  }, [panX, panY, spacePressed, startCanvasPan]);

  const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isDraggingCanvas && isDragging) {
      setPan(e.evt.clientX - dragStart.x, e.evt.clientY - dragStart.y);
    }
  }, [isDraggingCanvas, isDragging, dragStart, setPan]);

  const handleStageMouseUp = useCallback(() => {
    setIsDragging(false);
    endCanvasPan();
  }, [endCanvasPan]);

  // Keyboard shortcuts for spacebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isInputElement(e.target)) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Prevent context menu on right click
  const handleContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
  }, []);

  // Create text editor overlay for text editing
  const createTextEditor = useCallback((konvaTextNode: Konva.Text, elementId: string) => {
    const stage = stageRef.current;
    if (!stage || !wrapperRef.current) return;

    // Remove any existing text editor
    const existingEditor = document.querySelector('.konva-text-editor') as HTMLTextAreaElement;
    if (existingEditor) {
      existingEditor.remove();
    }

    const container = stage.container();
    const stageBox = container.getBoundingClientRect();
    
    // Get element position from store (more reliable than node position)
    const element = elements[elementId] as TextElement;
    if (!element) return;
    
    // Convert page coordinates to stage coordinates (accounting for pan and zoom)
    const stageX = element.x * zoom + panX;
    const stageY = element.y * zoom + panY;

    // Create textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'konva-text-editor';
    textarea.value = konvaTextNode.text();
    
    // Position and style textarea to match Konva text
    const x = stageBox.left + stageX;
    const y = stageBox.top + stageY;
    const width = konvaTextNode.width() * zoom;
    const height = Math.max(konvaTextNode.height() * zoom, 20);

    textarea.style.position = 'fixed';
    textarea.style.left = `${x}px`;
    textarea.style.top = `${y}px`;
    textarea.style.width = `${width}px`;
    textarea.style.height = `${height}px`;
    textarea.style.fontSize = `${konvaTextNode.fontSize() * zoom}px`;
    textarea.style.fontFamily = konvaTextNode.fontFamily();
    textarea.style.fontWeight = konvaTextNode.fontStyle() || 'normal';
    textarea.style.color = konvaTextNode.fill();
    textarea.style.textAlign = konvaTextNode.align();
    textarea.style.border = 'none';
    textarea.style.outline = '1px solid #3b82f6';
    textarea.style.background = 'rgba(255, 255, 255, 0.9)';
    textarea.style.padding = '2px';
    textarea.style.margin = '0';
    textarea.style.overflow = 'hidden';
    textarea.style.resize = 'none';
    textarea.style.whiteSpace = 'pre-wrap';
    textarea.style.wordWrap = 'break-word';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    // Handle save on Enter (without Shift)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveText();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelText();
      }
    };

    // Handle save on blur
    const handleBlur = () => {
      saveText();
    };

    const saveText = () => {
      const newText = textarea.value;
      const element = elements[elementId] as TextElement;
      if (element) {
        updateElement(elementId, { text: newText });
        useEditorStore.getState().pushHistory();
      }
      textarea.remove();
      setEditingTextId(null);
      stage.draw();
      if (wrapperRef.current) {
        wrapperRef.current.focus();
      }
    };

    const cancelText = () => {
      textarea.remove();
      setEditingTextId(null);
      stage.draw();
      if (wrapperRef.current) {
        wrapperRef.current.focus();
      }
    };

    textarea.addEventListener('keydown', handleKeyDown);
    textarea.addEventListener('blur', handleBlur);

    setEditingTextId(elementId);
  }, [elements, updateElement, stageRef, zoom, panX, panY]);

  // Handle double-click on text elements
  const handleTextDoubleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>, elementId: string) => {
    e.cancelBubble = true;
    const stage = stageRef.current;
    if (!stage) return;

    const element = elements[elementId] as TextElement;
    if (!element || element.type !== 'text') return;

    // Find the Konva Text node
    const textNode = stage.findOne(`#${elementId}`) as Konva.Text;
    if (textNode) {
      createTextEditor(textNode, elementId);
    }
  }, [elements, createTextEditor]);

  // Render element
  const renderElement = (element: EditorElement) => {
    const isSelected = selectedIds.includes(element.id);
    const commonProps = {
      key: element.id,
      x: element.x,
      y: element.y,
      rotation: element.rotation,
      opacity: element.opacity,
      draggable: !element.locked && !isDraggingCanvas,
      onDragMove: handleElementDrag(element),
      onDragEnd: handleElementDragEnd,
      onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
        e.cancelBubble = true;
        if (e.evt.shiftKey) {
          toggleSelect(element.id);
        } else {
          selectSingle(element.id);
        }
      },
    };

    switch (element.type) {
      case 'text': {
        const textEl = element as TextElement;
        return (
          <Text
            {...commonProps}
            id={element.id}
            text={textEl.text}
            fontSize={textEl.fontSize}
            fontFamily={textEl.fontFamily}
            fontStyle={textEl.fontWeight === 'bold' ? 'bold' : textEl.fontWeight === 'normal' ? 'normal' : textEl.fontWeight}
            fill={textEl.fill}
            width={textEl.width}
            align={textEl.align}
            verticalAlign="middle"
            onDblClick={(e) => handleTextDoubleClick(e, element.id)}
          />
        );
      }

      case 'rect': {
        const rectEl = element as RectElement;
        return (
          <Rect
            {...commonProps}
            id={element.id}
            width={rectEl.width}
            height={rectEl.height}
            fill={rectEl.fill}
            cornerRadius={rectEl.cornerRadius}
            stroke={rectEl.stroke}
            strokeWidth={rectEl.strokeWidth}
          />
        );
      }

      case 'circle': {
        const circleEl = element as CircleElement;
        return (
          <Circle
            {...commonProps}
            id={element.id}
            radius={Math.min(circleEl.width, circleEl.height) / 2}
            fill={circleEl.fill}
            stroke={circleEl.stroke}
            strokeWidth={circleEl.strokeWidth}
          />
        );
      }

      case 'image': {
        const imageEl = element as ImageElement;
        return <ImageElementRenderer key={element.id} element={imageEl} {...commonProps} />;
      }

      case 'qrcode': {
        const qrEl = element as QRElement;
        return <QRElementRenderer key={element.id} element={qrEl} {...commonProps} />;
      }

      case 'group': {
        const groupEl = element as GroupElement;
        const children = groupEl.childIds
          .map((id) => elements[id])
          .filter((el): el is EditorElement => el !== undefined);
        
        return (
          <Group {...commonProps} id={element.id}>
            {children.map((child) => renderElement(child))}
          </Group>
        );
      }

      default:
        return null;
    }
  };

  // Calculate stage size
  const stageWidth = page.width * zoom;
  const stageHeight = page.height * zoom;

  // Determine cursor style based on interaction mode
  const getCursorStyle = () => {
    if (isDraggingCanvas) return 'grabbing';
    if (spacePressed) return 'grab';
    return 'default';
  };

  // Update container cursor style directly
  useEffect(() => {
    const container = stageRef.current?.container();
    if (container) {
      container.style.cursor = getCursorStyle();
    }
  }, [isDraggingCanvas, spacePressed, stageRef]);

  // Cleanup text editor on unmount
  useEffect(() => {
    return () => {
      const existingEditor = document.querySelector('.konva-text-editor') as HTMLTextAreaElement;
      if (existingEditor) {
        existingEditor.remove();
      }
    };
  }, []);

  return (
    <div
      ref={(node) => {
        if (node) {
          wrapperRef.current = node;
          if (containerRef) {
            (containerRef as React.MutableRefObject<HTMLDivElement>).current = node;
          }
        }
      }}
      className="canvas-wrapper flex-1 flex items-center justify-center overflow-hidden bg-slate-900"
      tabIndex={0}
      style={{ pointerEvents: 'auto' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={containerRef.current?.clientWidth || 800}
        height={containerRef.current?.clientHeight || 600}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onContextMenu={handleContextMenu}
        style={{ cursor: getCursorStyle() }}
      >
        {/* Background Layer */}
        <Layer>
          <CanvasBackground page={page} showBleed={showBleed} />
        </Layer>

        {/* Bleed Overlay Layer */}
        <Layer
          x={panX}
          y={panY}
          scaleX={zoom}
          scaleY={zoom}
        >
          <BleedOverlay showBleed={showBleed} showSafeZone={showSafeZone} />
        </Layer>

        {/* Guides Layer */}
        <Layer>
          {snapGuides.map((guide, i) => (
            <Line
              key={`guide-${i}`}
              points={
                guide.type === 'vertical'
                  ? [guide.position, 0, guide.position, page.height]
                  : [0, guide.position, page.width, guide.position]
              }
              stroke="#3b82f6"
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          ))}
        </Layer>

        {/* Elements Layer */}
        <Layer
          x={panX + (showBleed ? FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_INSET * zoom : 0)}
          y={panY + (showBleed ? FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_INSET * zoom : 0)}
          scaleX={zoom}
          scaleY={zoom}
        >
          {orderedElements.map(renderElement)}
        </Layer>

        {/* Selection/Transform Layer */}
        <Layer
          x={panX + (showBleed ? FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_INSET * zoom : 0)}
          y={panY + (showBleed ? FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_INSET * zoom : 0)}
          scaleX={zoom}
          scaleY={zoom}
        >
          {selectedIds.length > 0 && (
            <TransformHandles
              selectedIds={selectedIds}
              elements={elements}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}

// Image Element Renderer
function ImageElementRenderer({
  element,
  ...props
}: {
  element: ImageElement;
  [key: string]: unknown;
}) {
  const image = useKonvaImage(element.imageUrl);

  if (!image) return null;

  return (
    <Group {...props} id={element.id}>
      <KonvaImage
        image={image}
        width={element.width}
        height={element.height}
        maintainAspectRatio={element.maintainAspectRatio}
      />
    </Group>
  );
}

// QR Element Renderer
function QRElementRenderer({
  element,
  ...props
}: {
  element: QRElement;
  [key: string]: unknown;
}) {
  const qrImage = useQrImage(element.targetUrl, Math.min(element.width, element.height));

  if (!qrImage) return null;

  return (
    <Group {...props} id={element.id}>
      <KonvaImage
        image={qrImage}
        width={element.width}
        height={element.height}
      />
    </Group>
  );
}

// Helper to check if target is input
function isInputElement(target: EventTarget | null): boolean {
  if (!target) return false;
  const element = target as HTMLElement;
  const tagName = element.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || element.isContentEditable;
}

