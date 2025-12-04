/**
 * Editor Templates
 * 
 * Pre-defined templates for quick starting designs.
 */

import type { EditorStateSnapshot } from './types';
import { generateId } from './utils';

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  thumbnailUrl?: string;
  snapshot: EditorStateSnapshot;
}

/**
 * Open House Flyer Template
 * Vertical page (1200 x 1600) with header, image, text, QR code
 */
function createOpenHouseTemplate(): EditorStateSnapshot {
  const pageId = generateId();
  const headerId = generateId();
  const headerTextId = generateId();
  const imageId = generateId();
  const subheadingId = generateId();
  const qrId = generateId();
  const agentInfoId = generateId();
  
  return {
    pages: {
      [pageId]: {
        id: pageId,
        name: 'Open House Flyer',
        width: 1200,
        height: 1600,
        backgroundColor: '#ffffff',
        elementIds: [headerId, headerTextId, imageId, subheadingId, qrId, agentInfoId],
      },
    },
    currentPageId: pageId,
    elements: {
      [headerId]: {
        id: headerId,
        type: 'rect',
        name: 'Header Background',
        x: 0,
        y: 0,
        width: 1200,
        height: 200,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 0,
        fill: '#1a5f3f',
        cornerRadius: 0,
      },
      [headerTextId]: {
        id: headerTextId,
        type: 'text',
        name: 'Header Text',
        x: 600,
        y: 100,
        width: 800,
        height: 80,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 1,
        text: 'OPEN HOUSE',
        fontSize: 64,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        fill: '#ffffff',
        align: 'center',
      },
      [imageId]: {
        id: imageId,
        type: 'image',
        name: 'Property Image',
        x: 100,
        y: 250,
        width: 1000,
        height: 600,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 2,
        imageUrl: 'https://via.placeholder.com/1000x600/cccccc/666666?text=Property+Image',
        maintainAspectRatio: true,
      },
      [subheadingId]: {
        id: subheadingId,
        type: 'text',
        name: 'Subheading',
        x: 600,
        y: 900,
        width: 1000,
        height: 60,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 3,
        text: 'Come see this beautiful property!',
        fontSize: 36,
        fontFamily: 'Arial, sans-serif',
        fontWeight: '600',
        fill: '#333333',
        align: 'center',
      },
      [qrId]: {
        id: qrId,
        type: 'qrcode',
        name: 'QR Code',
        x: 500,
        y: 1000,
        width: 200,
        height: 200,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 4,
        targetUrl: 'https://example.com/open-house',
      },
      [agentInfoId]: {
        id: agentInfoId,
        type: 'text',
        name: 'Agent Info',
        x: 600,
        y: 1300,
        width: 1000,
        height: 200,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 5,
        text: 'Contact: John Doe\nPhone: (555) 123-4567\nEmail: john@example.com',
        fontSize: 24,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#333333',
        align: 'center',
      },
    },
    selectedIds: [],
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}

/**
 * Just Listed Postcard Template
 * Landscape page (1600 x 1200) with photo on left, text on right
 */
function createJustListedTemplate(): EditorStateSnapshot {
  const pageId = generateId();
  const photoId = generateId();
  const priceId = generateId();
  const addressId = generateId();
  const ctaId = generateId();
  const qrId = generateId();
  
  return {
    pages: {
      [pageId]: {
        id: pageId,
        name: 'Just Listed Postcard',
        width: 1600,
        height: 1200,
        backgroundColor: '#ffffff',
        elementIds: [photoId, priceId, addressId, ctaId, qrId],
      },
    },
    currentPageId: pageId,
    elements: {
      [photoId]: {
        id: photoId,
        type: 'image',
        name: 'Property Photo',
        x: 0,
        y: 0,
        width: 800,
        height: 1200,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 0,
        imageUrl: 'https://via.placeholder.com/800x1200/cccccc/666666?text=Property+Photo',
        maintainAspectRatio: true,
      },
      [priceId]: {
        id: priceId,
        type: 'text',
        name: 'Price',
        x: 900,
        y: 200,
        width: 600,
        height: 100,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 1,
        text: '$899,000',
        fontSize: 72,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        fill: '#1a5f3f',
        align: 'left',
      },
      [addressId]: {
        id: addressId,
        type: 'text',
        name: 'Address',
        x: 900,
        y: 350,
        width: 600,
        height: 80,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 2,
        text: '123 Main Street, City, ST 12345',
        fontSize: 32,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#666666',
        align: 'left',
      },
      [ctaId]: {
        id: ctaId,
        type: 'text',
        name: 'CTA',
        x: 900,
        y: 500,
        width: 600,
        height: 120,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 3,
        text: 'Schedule a viewing today!\nCall or scan QR code for more info.',
        fontSize: 28,
        fontFamily: 'Arial, sans-serif',
        fontWeight: '600',
        fill: '#333333',
        align: 'left',
      },
      [qrId]: {
        id: qrId,
        type: 'qrcode',
        name: 'QR Code',
        x: 1100,
        y: 700,
        width: 200,
        height: 200,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 4,
        targetUrl: 'https://example.com/just-listed',
      },
    },
    selectedIds: [],
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}

/**
 * Blank Template
 * Simple blank page with default dimensions
 */
function createBlankTemplate(): EditorStateSnapshot {
  const pageId = generateId();
  
  return {
    pages: {
      [pageId]: {
        id: pageId,
        name: 'Blank Page',
        width: 1200,
        height: 1600,
        backgroundColor: '#ffffff',
        elementIds: [],
      },
    },
    currentPageId: pageId,
    elements: {},
    selectedIds: [],
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}

/**
 * Get template by ID
 */
export function getTemplateById(id: string): EditorStateSnapshot | null {
  switch (id) {
    case 'open-house':
      return createOpenHouseTemplate();
    case 'just-listed':
      return createJustListedTemplate();
    case 'blank':
      return createBlankTemplate();
    default:
      return null;
  }
}

/**
 * Get all available templates
 */
export function getAllTemplates(): TemplateDefinition[] {
  return [
    {
      id: 'open-house',
      name: 'Open House Flyer',
      description: 'Vertical flyer with header, image, and QR code',
      snapshot: createOpenHouseTemplate(),
    },
    {
      id: 'just-listed',
      name: 'Just Listed Postcard',
      description: 'Landscape postcard with photo and details',
      snapshot: createJustListedTemplate(),
    },
    {
      id: 'blank',
      name: 'Blank Page',
      description: 'Start from scratch',
      snapshot: createBlankTemplate(),
    },
  ];
}



