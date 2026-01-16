/**
 * Mapper from Overture address records to canonical campaign address format
 */

import type { CanonicalCampaignAddress } from './types';
import type { OvertureAddress } from '@/lib/services/OvertureService';

/**
 * Convert Overture address record to canonical campaign address format
 * @param address Overture address record with gers_id, geometry, and address components
 * @param campaignId Campaign ID to associate the address with
 * @param seq Sequence number for ordering
 * @returns Canonical campaign address ready for database insertion
 */
export function mapOvertureToCanonical(
  address: OvertureAddress,
  campaignId: string,
  seq: number
): CanonicalCampaignAddress {
  // Build formatted address from components
  const addressParts: string[] = [];
  
  // Add street address (may include house number)
  if (address.street) {
    addressParts.push(address.street);
  }
  
  // Add unit if present
  if (address.unit) {
    addressParts.push(address.unit);
  }
  
  const formatted = addressParts.length > 0 
    ? addressParts.join(', ')
    : 'Address not available';

  // Extract lat/lng from geometry (Point)
  let lat = 0;
  let lng = 0;
  
  if (address.geometry && address.geometry.type === 'Point') {
    const coords = address.geometry.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      lng = coords[0]; // Longitude first in GeoJSON
      lat = coords[1];
    }
  }

  // Convert to WKT format: POINT(lng lat)
  const geom = `POINT(${lng} ${lat})`;

  return {
    campaign_id: campaignId,
    formatted,
    postal_code: address.postcode || null,
    source: 'overture',
    seq,
    visited: false,
    geom,
    source_id: address.gers_id,
  };
}
