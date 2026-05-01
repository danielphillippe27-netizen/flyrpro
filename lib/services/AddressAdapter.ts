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
    [key: string]: unknown;
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
  lat?: number;
  lon?: number;
  geom: string; // GeoJSON string for PostGIS
  source: 'gold' | 'lambda';
  gers_id?: string | null;
}

export class AddressAdapter {
  private static pointFromGeometry(value: unknown): { lat: number; lon: number } | null {
    try {
      const geometry = typeof value === 'string' ? JSON.parse(value) : value;
      const coordinates = (geometry as { coordinates?: unknown })?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
    } catch {
      return null;
    }
  }

  private static normalizeRegion(value: unknown, fallbackRegion?: string | null): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().toUpperCase();
    }
    if (typeof fallbackRegion === 'string' && fallbackRegion.trim()) {
      return fallbackRegion.trim().toUpperCase();
    }
    return null;
  }

  /**
   * Convert Gold database row to standard campaign address
   */
  static fromGoldRow(
    row: GoldAddressRow,
    campaignId: string,
    fallbackRegion?: string | null
  ): StandardCampaignAddress {
    const lon = Number(row.lon);
    const lat = Number(row.lat);
    const goldAddressId = typeof row.id === 'string' && row.id.trim()
      ? `gold:${row.id.trim()}`
      : null;
    
    return {
      campaign_id: campaignId,
      formatted: `${row.street_number || ''} ${row.street_name || ''}${row.unit ? ' ' + row.unit : ''}, ${row.city || ''}`.trim(),
      house_number: row.street_number,
      street_name: row.street_name,
      locality: row.city,
      region: this.normalizeRegion(row.province, fallbackRegion) ?? undefined,
      postal_code: row.zip,
      coordinate: { lat, lon },
      lat,
      lon,
      geom: `{"type":"Point","coordinates":[${lon},${lat}]}`,
      source: 'gold',
      gers_id: goldAddressId,
    };
  }

  /**
   * Convert Lambda GeoJSON feature to standard campaign address
   */
  static fromLambdaFeature(
    feature: LambdaAddressFeature,
    campaignId: string,
    fallbackRegion?: string | null
  ): StandardCampaignAddress {
    const [lon, lat] = feature.geometry.coordinates;
    
    return {
      campaign_id: campaignId,
      formatted: feature.properties.formatted || feature.properties.label || '',
      house_number: feature.properties.house_number,
      street_name: feature.properties.street_name,
      locality: feature.properties.city,
      region: this.normalizeRegion(feature.properties.state, fallbackRegion) ?? undefined,
      postal_code: feature.properties.postal_code,
      coordinate: { lat, lon },
      lat,
      lon,
      geom: JSON.stringify(feature.geometry),
      source: 'lambda',
      gers_id: feature.properties.gers_id,
    };
  }

  /**
   * Convert already-normalized address (from GoldAddressService) to standard format
   * Handles the case where geom might be object or string
   */
  static fromNormalized(
    addr: Record<string, unknown>,
    campaignId: string,
    fallbackRegion?: string | null
  ): StandardCampaignAddress {
    // Handle geom as string or object
    const geomString = typeof addr.geom === 'string' 
      ? addr.geom 
      : JSON.stringify(addr.geom);
    const geometryPoint = this.pointFromGeometry(addr.geom);
    const rawCoordinate = addr.coordinate as { lat?: unknown; lon?: unknown } | undefined;
    const coordinate =
      rawCoordinate && Number.isFinite(Number(rawCoordinate.lat)) && Number.isFinite(Number(rawCoordinate.lon))
        ? { lat: Number(rawCoordinate.lat), lon: Number(rawCoordinate.lon) }
        : geometryPoint ?? undefined;
    const lat = Number.isFinite(Number(addr.lat)) ? Number(addr.lat) : coordinate?.lat;
    const lon = Number.isFinite(Number(addr.lon)) ? Number(addr.lon) : coordinate?.lon;
    const source = addr.source === 'gold' ? 'gold' : 'lambda';

    return {
      campaign_id: campaignId,
      formatted: typeof addr.formatted === 'string' ? addr.formatted : '',
      house_number: typeof addr.house_number === 'string' ? addr.house_number : undefined,
      street_name: typeof addr.street_name === 'string' ? addr.street_name : undefined,
      locality:
        typeof addr.locality === 'string'
          ? addr.locality
          : typeof addr.city === 'string'
            ? addr.city
            : undefined,
      region: this.normalizeRegion(addr.region ?? addr.province ?? addr.state, fallbackRegion) ?? undefined,
      postal_code: typeof addr.postal_code === 'string' ? addr.postal_code : undefined,
      coordinate,
      lat,
      lon,
      geom: geomString,
      source,
      gers_id: typeof addr.gers_id === 'string' && addr.gers_id.trim() ? addr.gers_id : null,
    };
  }

  /**
   * Normalize array of addresses from mixed sources
   * Auto-detects Gold vs Lambda format
   */
  static normalizeArray(
    addresses: Array<Record<string, unknown>>,
    campaignId: string,
    fallbackRegion?: string | null
  ): StandardCampaignAddress[] {
    if (!addresses || addresses.length === 0) return [];

    // Detect format based on first address
    const first = addresses[0];
    const isGoldFormat = first.lat !== undefined && first.lon !== undefined;

    if (isGoldFormat) {
      console.log(`[AddressAdapter] Normalizing ${addresses.length} Gold addresses`);
      return addresses.map((addr) => this.fromGoldRow(addr, campaignId, fallbackRegion));
    } else {
      console.log(`[AddressAdapter] Normalizing ${addresses.length} Lambda/normalized addresses`);
      return addresses.map((addr) => this.fromNormalized(addr, campaignId, fallbackRegion));
    }
  }
}
