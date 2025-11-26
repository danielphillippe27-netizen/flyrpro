/**
 * Template Converter
 * 
 * Converts old FlyerTemplate format to new EditorStateSnapshot format
 */

import type { FlyerTemplate, FlyerElement } from '@/lib/types/flyers';
import type { EditorStateSnapshot, EditorElement, TextElement, RectElement, ImageElement, QRElement } from './types';
import { generateId } from './utils';

/**
 * Convert a FlyerTemplate to EditorStateSnapshot
 */
export function convertFlyerTemplateToEditorState(
  flyerTemplate: FlyerTemplate
): EditorStateSnapshot {
  const pageId = generateId();
  const elements: Record<string, EditorElement> = {};
  const elementIds: string[] = [];

  // Convert each flyer element to editor element
  flyerTemplate.elements.forEach((flyerEl) => {
    const editorEl = convertFlyerElementToEditorElement(flyerEl);
    if (editorEl) {
      elements[editorEl.id] = editorEl;
      elementIds.push(editorEl.id);
    }
  });

  return {
    pages: {
      [pageId]: {
        id: pageId,
        name: flyerTemplate.name,
        width: flyerTemplate.width,
        height: flyerTemplate.height,
        backgroundColor: flyerTemplate.backgroundColor || '#ffffff',
        backgroundImageUrl: flyerTemplate.backgroundImageUrl,
        elementIds,
      },
    },
    currentPageId: pageId,
    elements,
    selectedIds: [],
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}

/**
 * Convert a FlyerElement to EditorElement
 */
function convertFlyerElementToEditorElement(
  flyerEl: FlyerElement
): EditorElement | null {
  const baseProps = {
    id: flyerEl.id,
    name: getElementName(flyerEl),
    x: flyerEl.x,
    y: flyerEl.y,
    width: 0, // Will be set per type
    height: 0, // Will be set per type
    rotation: flyerEl.rotation || 0,
    opacity: flyerEl.opacity ?? 1,
    locked: false,
    visible: true,
    zIndex: 0,
  };

  switch (flyerEl.type) {
    case 'text': {
      const textEl = flyerEl as any;
      const maxWidth = textEl.maxWidth || 400;
      // For center-aligned text, the x coordinate in old format is the center point
      // In new format, x is the left edge, so we need to adjust
      let x = textEl.x;
      if (textEl.align === 'center' && textEl.maxWidth) {
        x = textEl.x - maxWidth / 2;
      } else if (textEl.align === 'right' && textEl.maxWidth) {
        x = textEl.x - maxWidth;
      }
      
      const element: TextElement = {
        ...baseProps,
        type: 'text',
        text: textEl.text,
        fontSize: textEl.fontSize,
        fontFamily: textEl.fontFamily || 'Arial, sans-serif',
        fontWeight: textEl.fontWeight || 'normal',
        fill: textEl.fill,
        align: textEl.align || 'left',
        width: maxWidth,
        height: textEl.fontSize * 1.5, // Approximate height
        x, // Use adjusted x coordinate
      };
      return element;
    }

    case 'rect': {
      const rectEl = flyerEl as any;
      const element: RectElement = {
        ...baseProps,
        type: 'rect',
        width: rectEl.width,
        height: rectEl.height,
        fill: rectEl.fill,
        cornerRadius: rectEl.cornerRadius || 0,
      };
      return element;
    }

    case 'image': {
      const imageEl = flyerEl as any;
      const element: ImageElement = {
        ...baseProps,
        type: 'image',
        width: imageEl.width,
        height: imageEl.height,
        imageUrl: imageEl.url,
        maintainAspectRatio: imageEl.objectFit === 'contain',
      };
      return element;
    }

    case 'qrcode': {
      const qrEl = flyerEl as any;
      const element: QRElement = {
        ...baseProps,
        type: 'qrcode',
        width: qrEl.size,
        height: qrEl.size,
        targetUrl: qrEl.url,
      };
      return element;
    }

    default:
      console.warn(`Unknown element type: ${(flyerEl as any).type}`);
      return null;
  }
}

/**
 * Generate a friendly name for an element based on its type and content
 */
function getElementName(flyerEl: FlyerElement): string {
  if (flyerEl.id.includes('headline') || flyerEl.id.includes('title')) {
    return 'Heading';
  }
  if (flyerEl.id.includes('subheadline') || flyerEl.id.includes('subtitle')) {
    return 'Subheading';
  }
  if (flyerEl.id.includes('photo') || flyerEl.id.includes('image')) {
    return 'Image';
  }
  if (flyerEl.id.includes('qr')) {
    return 'QR Code';
  }
  if (flyerEl.id.includes('bg') || flyerEl.id.includes('background')) {
    return 'Background';
  }
  if (flyerEl.type === 'text') {
    const textEl = flyerEl as any;
    return textEl.text?.substring(0, 20) || 'Text';
  }
  return flyerEl.type.charAt(0).toUpperCase() + flyerEl.type.slice(1);
}

