/**
 * AI Template Converter
 * 
 * Converts AI-generated FlyerTemplate to database FlyerData format
 */

import type { FlyerTemplate, FlyerElement } from '@/types/flyer';
import type { FlyerData, FlyerElement as DbFlyerElement } from '@/lib/flyers/types';
import { generateId } from '@/lib/editor/utils';

/**
 * Convert AI FlyerTemplate to database FlyerData format
 */
export function convertAITemplateToFlyerData(
  template: FlyerTemplate,
  listing: {
    address: string;
    price: string;
    beds: number;
    baths: number;
    sqFt?: number;
    callToAction: string;
    photoUrl?: string;
    qrUrl: string;
    campaignType: string;
  }
): FlyerData {
  const elements: DbFlyerElement[] = [];

  template.elements.forEach((aiEl) => {
    if (aiEl.type === 'headline' || aiEl.type === 'subheadline' || aiEl.type === 'body' || aiEl.type === 'label') {
      // Text element
      let text = aiEl.text || '';
      
      // Bind text if needed
      if (aiEl.bind) {
        switch (aiEl.bind) {
          case 'status':
            text = listing.campaignType.toUpperCase();
            break;
          case 'address':
            text = listing.address;
            break;
          case 'price':
            text = listing.price;
            break;
          case 'bedsBaths':
            text = `${listing.beds} Bed | ${listing.baths} Bath${listing.sqFt ? ` | ${listing.sqFt} SF` : ''}`;
            break;
          case 'description':
            text = listing.callToAction;
            break;
        }
      }

      const dbEl: DbFlyerElement = {
        id: generateId(),
        type: 'text',
        x: aiEl.x,
        y: aiEl.y,
        width: aiEl.width || 400,
        height: (aiEl.fontSize || 16) * 1.5, // Approximate height
        rotation: 0,
        text,
        fontFamily: 'Arial, sans-serif',
        fontSize: aiEl.fontSize,
        fontWeight: aiEl.fontWeight || 'normal',
        align: aiEl.align || 'left',
        fill: aiEl.color,
      };
      elements.push(dbEl);
    } else if (aiEl.type === 'image') {
      // Image element
      const dbEl: DbFlyerElement = {
        id: generateId(),
        type: 'image',
        x: aiEl.x,
        y: aiEl.y,
        width: aiEl.width,
        height: aiEl.height,
        rotation: 0,
        imageUrl: listing.photoUrl || '',
        objectFit: 'cover',
      };
      elements.push(dbEl);
    } else if (aiEl.type === 'qr') {
      // QR element
      const dbEl: DbFlyerElement = {
        id: generateId(),
        type: 'qr',
        x: aiEl.x,
        y: aiEl.y,
        size: aiEl.size,
        rotation: 0,
        url: listing.qrUrl,
      };
      elements.push(dbEl);
    }
    // Note: shapes are not supported in the database format, so we skip them
  });

  return {
    backgroundColor: template.backgroundColor,
    elements,
  };
}

