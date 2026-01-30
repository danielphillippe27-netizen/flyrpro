/**
 * Canonical types for geographic/campaign address data
 * These types match the campaign_addresses table schema
 */

export interface CanonicalCampaignAddress {
  campaign_id: string;
  formatted: string;
  postal_code?: string | null;
  source: 'closest_home' | 'import_list' | 'map' | 'same_street';
  seq: number;
  visited?: boolean;
  geom: string; // WKT format: 'POINT(lng lat)'
  gers_id?: string | null; // Overture gers_id for deduplication - UUID v4 format (128-bit)
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  region?: string | null;
  building_gers_id?: string | null; // Parent building GERS ID from Overture (parent_id)
}
