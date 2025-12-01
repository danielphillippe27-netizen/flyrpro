/**
 * Flyer Editor Type Definitions
 * 
 * Defines the structure for flyer templates, elements, and instances
 * used in the flyer editor system.
 */

export type FlyerElementType = 'text' | 'image' | 'qrcode' | 'rect';

export interface FlyerElementBase {
  id: string;
  type: FlyerElementType;
  x: number;
  y: number;
  rotation?: number;
  opacity?: number;
}

export interface FlyerTextElement extends FlyerElementBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold' | '600' | '700';
  fill: string;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
}

export interface FlyerImageElement extends FlyerElementBase {
  type: 'image';
  url: string; // can be a placeholder initially
  width: number;
  height: number;
  objectFit?: 'cover' | 'contain';
}

export interface FlyerQRCodeElement extends FlyerElementBase {
  type: 'qrcode';
  url: string; // target URL to encode
  size: number; // width/height
}

export interface FlyerRectElement extends FlyerElementBase {
  type: 'rect';
  width: number;
  height: number;
  fill: string;
  cornerRadius?: number;
}

export type FlyerElement =
  | FlyerTextElement
  | FlyerImageElement
  | FlyerQRCodeElement
  | FlyerRectElement;

export interface FlyerTemplate {
  id: string;
  name: string;
  description?: string;
  thumbnailUrl?: string;
  width: number;   // base canvas width (e.g. 1200)
  height: number;  // base canvas height (e.g. 1600)
  backgroundColor?: string;
  backgroundImageUrl?: string;
  elements: FlyerElement[];
}

export interface FlyerInstance {
  id: string;
  templateId: string;
  title: string;
  data: {
    [elementId: string]: Partial<FlyerElement>;
  };
  createdAt: string;
  updatedAt: string;
}


