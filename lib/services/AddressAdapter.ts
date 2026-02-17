/**
 * AddressAdapter - Normalizes addresses from any source to standard campaign format
 * 
 * This module implements the Adapter Pattern:
 * - Gold: Database rows → Standard Campaign Address
 * - Silver (Lambda): GeoJSON features → Standard Campaign Address
 */

export interface GoldAddressRow {
  id?: string;
  source_id?: string;
  street_number?: string;
  street_name?: string;
  unit?: string;
  city?: string;
  zip?: string;
  province?: string;
  country?: string;
  lat?: number;
  lon?: number;
  geom_geojson?: string;
}

export interface LambdaAddressFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    gers_id?: string;
    house_number?: string;
    street_name?: string;
    city?: string;
    postal_code?: string;
    state?: string;
    formatted?: string;
    label?: string;
    [key: string]: any;
  };
}

export interface StandardCampaignAddress {
  campaign_id: string;
  formatted: string;
  house_number?: string;
  street_name?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  coordinate?: { lat: number; lon: number };
  geom: string; // GeoJSON string for PostGIS
  source: 'gold' | 'lambda';
  gers_id?: string | null;
}

export class AddressAdapter {
  /**
   * Convert Gold database row to standard campaign address
   */
  static fromGoldRow(row: GoldAddressRow, campaignId: string): StandardCampaignAddress {
    const lon = row.lon ?? 0;
    const lat = row.lat ?? 0;
    
    return {
      campaign_id: campaignId,
      formatted: `${row.street_number || ''} ${row.street_name || ''}${row.unit ? ' ' + row.unit : ''}, ${row.city || ''}`.trim(),
      house_number: row.street_number,
      street_name: row.street_name,
      locality: row.city,
      region: row.province || 'ON',
      postal_code: row.zip,
      coordinate: { lat, lon },
      geom: `{"type":"Point","coordinates":[${lon},${lat}]}`,
      source: 'gold',
      gers_id: row.source_id || null,
    };
  }

  /**
   * Convert Lambda GeoJSON feature to standard campaign address
   */
  static fromLambdaFeature(feature: LambdaAddressFeature, campaignId: string): StandardCampaignAddress {
    const [lon, lat] = feature.geometry.coordinates;
    
    return {
      campaign_id: campaignId,
      formatted: feature.properties.formatted || feature.properties.label || '',
      house_number: feature.properties.house_number,
      street_name: feature.properties.street_name,
      locality: feature.properties.city,
      region: feature.properties.state || 'ON',
      postal_code: feature.properties.postal_code,
      coordinate: { lat, lon },
      geom: JSON.stringify(feature.geometry),
      source: 'lambda',
      gers_id: feature.properties.gers_id,
    };
  }

  /**
   * Convert already-normalized address (from GoldAddressService) to standard format
   * Handles the case where geom might be object or string
   */
  static fromNormalized(addr: any, campaignId: string): StandardCampaignAddress {
    // Handle geom as string or object
    const geomString = typeof addr.geom === 'string' 
      ? addr.geom 
      : JSON.stringify(addr.geom);

    return {
      campaign_id: campaignId,
      formatted: addr.formatted || '',
      house_number: addr.house_number,
      street_name: addr.street_name,
      locality: addr.locality,
      region: addr.region || 'ON',
      postal_code: addr.postal_code,
      coordinate: addr.coordinate,
      geom: geomString,
      source: addr.source || 'lambda',
      gers_id: addr.gers_id || null,
    };
  }

  /**
   * Normalize array of addresses from mixed sources
   * Auto-detects Gold vs Lambda format
   */
  static normalizeArray(addresses: any[], campaignId: string): StandardCampaignAddress[] {
    if (!addresses || addresses.length === 0) return [];

    // Detect format based on first address
    const first = addresses[0];
    const isGoldFormat = first.lat !== undefined && first.lon !== undefined;

    if (isGoldFormat) {
      console.log(`[AddressAdapter] Normalizing ${addresses.length} Gold addresses`);
      return addresses.map((addr) => this.fromGoldRow(addr, campaignId));
    } else {
      console.log(`[AddressAdapter] Normalizing ${addresses.length} Lambda/normalized addresses`);
      return addresses.map((addr) => this.fromNormalized(addr, campaignId));
    }
  }
}
