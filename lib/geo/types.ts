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
  source_id?: string | null; // Overture gers_id for deduplication
}
