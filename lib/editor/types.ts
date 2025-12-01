/**
 * Editor Type Definitions
 * 
 * Core types for the Mini Canva-style editor including elements, pages, and state.
 */

export type ElementType = 'text' | 'rect' | 'circle' | 'image' | 'qrcode' | 'group';

export interface BaseElement {
  id: string;
  type: ElementType;
  name: string; // for layers panel
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number;  // 0-1
  locked: boolean;
  visible: boolean;
  zIndex: number;   // for manual ordering
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold' | '500' | '600' | '700';
  fill: string;
  align: 'left' | 'center' | 'right';
}

export interface RectElement extends BaseElement {
  type: 'rect';
  fill: string;
  cornerRadius: number;
  stroke?: string;
  strokeWidth?: number;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  imageUrl: string;
  maintainAspectRatio?: boolean;
}

export interface QRElement extends BaseElement {
  type: 'qrcode';
  targetUrl: string;
}

export interface GroupElement extends BaseElement {
  type: 'group';
  childIds: string[];
}

export type EditorElement =
  | TextElement
  | RectElement
  | CircleElement
  | ImageElement
  | QRElement
  | GroupElement;

export interface EditorPage {
  id: string;
  name: string;
  width: number;   // e.g. 1200
  height: number;  // e.g. 1600
  backgroundColor: string;
  backgroundImageUrl?: string;
  elementIds: string[]; // z-order from first (back) to last (front)
}

export interface EditorState {
  pages: Record<string, EditorPage>;
  currentPageId: string;
  elements: Record<string, EditorElement>;
  selectedIds: string[];           // multi-select
  hoveredId: string | null;
  zoom: number;                    // 0.1 - 4
  panX: number;
  panY: number;
  isDraggingCanvas: boolean;
  history: EditorHistory;
}

export interface EditorHistory {
  past: EditorStateSnapshot[];
  future: EditorStateSnapshot[];
}

export type EditorStateSnapshot = {
  pages: Record<string, EditorPage>;
  elements: Record<string, EditorElement>;
  currentPageId: string;
  selectedIds: string[];
  zoom: number;
  panX: number;
  panY: number;
};


