/**
 * Flyer Editor Type Definitions
 * 
 * Types for the campaign flyer editor system.
 */

export type FlyerElementType = 'text' | 'image' | 'qr';

export interface FlyerTextElement {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: 'normal' | 'bold';
  align?: 'left' | 'center' | 'right';
  fill: string;
}

export interface FlyerImageElement {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  imageUrl: string;
  objectFit?: 'cover' | 'contain';
}

export interface FlyerQRElement {
  id: string;
  type: 'qr';
  x: number;
  y: number;
  size: number;
  rotation: number;
  url: string;
}

export type FlyerElement = FlyerTextElement | FlyerImageElement | FlyerQRElement;

export interface FlyerData {
  backgroundColor: string;
  elements: FlyerElement[];
}

export interface Flyer {
  id: string;
  campaign_id: string;
  name: string;
  size: string;
  data: FlyerData;
  created_at: string;
  updated_at: string;
}



