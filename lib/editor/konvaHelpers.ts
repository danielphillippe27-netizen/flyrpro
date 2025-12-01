/**
 * Konva-specific Helper Functions
 * 
 * Utilities for working with Konva objects, hit detection, and coordinate conversion.
 */

import type Konva from 'konva';
import type { EditorElement } from './types';

/**
 * Check if a point is within an element's bounds
 */
export function isPointInElement(
  x: number,
  y: number,
  element: EditorElement
): boolean {
  return (
    x >= element.x &&
    x <= element.x + element.width &&
    y >= element.y &&
    y <= element.y + element.height
  );
}

/**
 * Convert stage coordinates to page coordinates (accounting for zoom/pan)
 */
export function stageToPage(
  stageX: number,
  stageY: number,
  zoom: number,
  panX: number,
  panY: number
): { x: number; y: number } {
  return {
    x: (stageX - panX) / zoom,
    y: (stageY - panY) / zoom,
  };
}

/**
 * Convert page coordinates to stage coordinates (accounting for zoom/pan)
 */
export function pageToStage(
  pageX: number,
  pageY: number,
  zoom: number,
  panX: number,
  panY: number
): { x: number; y: number } {
  return {
    x: pageX * zoom + panX,
    y: pageY * zoom + panY,
  };
}

/**
 * Get the topmost element at a point (considering z-order)
 */
export function getElementAtPoint(
  x: number,
  y: number,
  elements: EditorElement[],
  elementIds: string[] // z-ordered from back to front
): EditorElement | null {
  // Check from front to back
  for (let i = elementIds.length - 1; i >= 0; i--) {
    const elementId = elementIds[i];
    const element = elements.find((e) => e.id === elementId);
    
    if (!element || !element.visible) continue;
    
    if (isPointInElement(x, y, element)) {
      return element;
    }
  }
  
  return null;
}

/**
 * Get bounding box for multiple elements
 */
export function getBoundingBox(elements: EditorElement[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (elements.length === 0) return null;
  
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  
  elements.forEach((element) => {
    const left = element.x;
    const top = element.y;
    const right = element.x + element.width;
    const bottom = element.y + element.height;
    
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  });
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Check if a Konva node is an input element (to avoid intercepting keyboard shortcuts)
 */
export function isInputElement(target: EventTarget | null): boolean {
  if (!target) return false;
  
  const element = target as HTMLElement;
  const tagName = element.tagName?.toLowerCase();
  const isInput = tagName === 'input' || tagName === 'textarea';
  const isContentEditable = element.isContentEditable;
  
  return isInput || isContentEditable;
}


