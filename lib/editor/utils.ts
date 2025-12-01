/**
 * Editor Utility Functions
 * 
 * Math helpers for snapping, alignment, and coordinate calculations.
 */

import type { EditorElement, EditorPage } from './types';

export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  position: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/**
 * Calculate distance between two points
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

/**
 * Check if a value is within snap threshold
 */
export function isWithinThreshold(value: number, target: number, threshold: number = 8): boolean {
  return Math.abs(value - target) <= threshold;
}

/**
 * Get element bounds (considering rotation)
 */
export function getElementBounds(element: EditorElement): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
} {
  const left = element.x;
  const right = element.x + element.width;
  const top = element.y;
  const bottom = element.y + element.height;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  
  return { left, right, top, bottom, centerX, centerY };
}

/**
 * Get canvas snap points (edges and center)
 */
export function getCanvasSnapPoints(page: EditorPage): {
  vertical: number[];
  horizontal: number[];
} {
  return {
    vertical: [0, page.width / 2, page.width],
    horizontal: [0, page.height / 2, page.height],
  };
}

/**
 * Get snap points from other elements (excluding selected)
 */
export function getElementSnapPoints(
  elements: Record<string, EditorElement>,
  excludeIds: string[]
): {
  vertical: number[];
  horizontal: number[];
} {
  const vertical: number[] = [];
  const horizontal: number[] = [];
  
  Object.values(elements).forEach((element) => {
    if (excludeIds.includes(element.id) || !element.visible) return;
    
    const bounds = getElementBounds(element);
    vertical.push(bounds.left, bounds.centerX, bounds.right);
    horizontal.push(bounds.top, bounds.centerY, bounds.bottom);
  });
  
  return { vertical, horizontal };
}

/**
 * Find the closest snap point
 */
function findClosestSnapPoint(
  value: number,
  snapPoints: number[],
  threshold: number = 8
): number | null {
  let closest: number | null = null;
  let minDistance = threshold;
  
  for (const point of snapPoints) {
    const dist = Math.abs(value - point);
    if (dist < minDistance) {
      minDistance = dist;
      closest = point;
    }
  }
  
  return closest;
}

/**
 * Calculate snapped position with guides
 */
export function calculateSnap(
  x: number,
  y: number,
  width: number,
  height: number,
  page: EditorPage,
  elements: Record<string, EditorElement>,
  excludeIds: string[],
  threshold: number = 8
): SnapResult {
  const guides: SnapGuide[] = [];
  let snappedX = x;
  let snappedY = y;
  
  // Get snap points
  const canvasSnaps = getCanvasSnapPoints(page);
  const elementSnaps = getElementSnapPoints(elements, excludeIds);
  
  const allVertical = [...canvasSnaps.vertical, ...elementSnaps.vertical];
  const allHorizontal = [...canvasSnaps.horizontal, ...elementSnaps.horizontal];
  
  // Calculate element reference points
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const left = x;
  const right = x + width;
  const top = y;
  const bottom = y + height;
  
  // Try snapping center X
  const snapCenterX = findClosestSnapPoint(centerX, allVertical, threshold);
  if (snapCenterX !== null) {
    snappedX = snapCenterX - width / 2;
    guides.push({ type: 'vertical', position: snapCenterX });
  } else {
    // Try snapping left edge
    const snapLeft = findClosestSnapPoint(left, allVertical, threshold);
    if (snapLeft !== null) {
      snappedX = snapLeft;
      guides.push({ type: 'vertical', position: snapLeft });
    } else {
      // Try snapping right edge
      const snapRight = findClosestSnapPoint(right, allVertical, threshold);
      if (snapRight !== null) {
        snappedX = snapRight - width;
        guides.push({ type: 'vertical', position: snapRight });
      }
    }
  }
  
  // Try snapping center Y
  const snapCenterY = findClosestSnapPoint(centerY, allHorizontal, threshold);
  if (snapCenterY !== null) {
    snappedY = snapCenterY - height / 2;
    guides.push({ type: 'horizontal', position: snapCenterY });
  } else {
    // Try snapping top edge
    const snapTop = findClosestSnapPoint(top, allHorizontal, threshold);
    if (snapTop !== null) {
      snappedY = snapTop;
      guides.push({ type: 'horizontal', position: snapTop });
    } else {
      // Try snapping bottom edge
      const snapBottom = findClosestSnapPoint(bottom, allHorizontal, threshold);
      if (snapBottom !== null) {
        snappedY = snapBottom - height;
        guides.push({ type: 'horizontal', position: snapBottom });
      }
    }
  }
  
  return { x: snappedX, y: snappedY, guides };
}

/**
 * Align elements to a common edge or center
 */
export function alignElements(
  elements: EditorElement[],
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
): Record<string, { x: number; y: number }> {
  if (elements.length === 0) return {};
  
  const updates: Record<string, { x: number; y: number }> = {};
  
  // Calculate reference point from first element
  const firstBounds = getElementBounds(elements[0]);
  let referenceX = firstBounds.left;
  let referenceY = firstBounds.top;
  
  if (alignment === 'left') {
    referenceX = firstBounds.left;
  } else if (alignment === 'center') {
    referenceX = firstBounds.centerX;
  } else if (alignment === 'right') {
    referenceX = firstBounds.right;
  } else if (alignment === 'top') {
    referenceY = firstBounds.top;
  } else if (alignment === 'middle') {
    referenceY = firstBounds.centerY;
  } else if (alignment === 'bottom') {
    referenceY = firstBounds.bottom;
  }
  
  // Apply alignment to all elements
  elements.forEach((element) => {
    const bounds = getElementBounds(element);
    let newX = element.x;
    let newY = element.y;
    
    if (alignment === 'left') {
      newX = referenceX;
    } else if (alignment === 'center') {
      newX = referenceX - element.width / 2;
    } else if (alignment === 'right') {
      newX = referenceX - element.width;
    } else if (alignment === 'top') {
      newY = referenceY;
    } else if (alignment === 'middle') {
      newY = referenceY - element.height / 2;
    } else if (alignment === 'bottom') {
      newY = referenceY - element.height;
    }
    
    updates[element.id] = { x: newX, y: newY };
  });
  
  return updates;
}

/**
 * Generate a unique ID for elements
 */
export function generateId(): string {
  return `elem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}


