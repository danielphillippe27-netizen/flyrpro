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
  // Build formatted address in North American format: "house_number street_name"
  // e.g., "714 Mason Street"
  let formatted = 'Address not available';
  
  if (address.house_number && address.street) {
    formatted = `${address.house_number} ${address.street}`;
  } else if (address.street) {
    formatted = address.street;
  } else if (address.house_number) {
    formatted = address.house_number;
  }

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
    gers_id: address.gers_id,
    house_number: address.house_number || null,
    street_name: address.street || null,
    locality: address.locality || null,
    region: address.region || null,
    building_gers_id: address.building_gers_id || null,
  };
}
