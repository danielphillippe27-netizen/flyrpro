import { createClient } from '@/lib/supabase/client';

export type CampaignMapManifest = {
  status?: 'pending' | 'ready' | 'partial' | 'failed';
  provider?: 'diamond' | 'bedrock';
  country?: string | null;
  countryCode?: string | null;
  regionCode?: string | null;
  issues?: string[];
  artifact_type?: 'diamond' | 'white_gold' | 'basic';
  geometry_provider?: string | null;
  geometry_delivery_mode?: string | null;
  supported_delivery_modes?: string[] | null;
  preferred_delivery_modes?: {
    web?: string | null;
    ios?: string | null;
  } | null;
  pmtiles_url?: string | null;
  geometry_url?: string | null;
  address_pmtiles_key?: string | null;
  address_tilejson_key?: string | null;
  address_pmtiles_url?: string | null;
  address_tilejson_url?: string | null;
  address_source_layer?: string | null;
  address_promote_id?: string | null;
  address_minzoom?: number | null;
  address_maxzoom?: number | null;
  address_bounds?: [number, number, number, number] | null;
  address_vector_tile_url_template?: string | null;
  vector_tile_url_template?: string | null;
  static_vector_tile_url_template?: string | null;
  building_bounds_buffer_meters?: number | null;
  buildings_render_mode?: 'vector_tiles' | 'geojson' | null;
  parcel_pmtiles_key?: string | null;
  parcel_tilejson_key?: string | null;
  parcel_pmtiles_url?: string | null;
  parcel_tilejson_url?: string | null;
  parcel_vector_tile_url_template?: string | null;
  parcel_source_layer?: string | null;
  parcel_promote_id?: string | null;
  parcel_minzoom?: number | null;
  parcel_maxzoom?: number | null;
  parcel_bounds?: [number, number, number, number] | null;
  source_layers?: {
    buildings?: string | null;
    parcels?: string | null;
    addresses?: string | null;
    address_circles?: string | null;
    address_building_links?: string | null;
  } | null;
  promote_ids?: {
    buildings?: string | null;
    parcels?: string | null;
    addresses?: string | null;
    address_circles?: string | null;
    address_building_links?: string | null;
  } | null;
  minzoom?: number | null;
  maxzoom?: number | null;
  bounds?: [number, number, number, number] | null;
  layers?: {
    buildings?: {
      kind?: 'pmtiles' | 'geojson' | 'ndjson_gzip';
      s3Key?: string | null;
      url?: string | null;
      vectorTileUrlTemplate?: string | null;
      sourceLayer?: string | null;
      promoteId?: string | null;
      minzoom?: number | null;
      maxzoom?: number | null;
      bounds?: [number, number, number, number] | null;
      boundsBufferMeters?: number | null;
      tileBuffer?: number | null;
    } | null;
    addresses?: {
      kind?: 'pmtiles' | 'geojson' | 'ndjson_gzip';
      s3Key?: string | null;
      url?: string | null;
      vectorTileUrlTemplate?: string | null;
      sourceLayer?: string | null;
      promoteId?: string | null;
      minzoom?: number | null;
      maxzoom?: number | null;
      bounds?: [number, number, number, number] | null;
    } | null;
    parcels?: {
      kind?: 'pmtiles' | 'geojson' | 'ndjson_gzip';
      s3Key?: string | null;
      url?: string | null;
      vectorTileUrlTemplate?: string | null;
      sourceLayer?: string | null;
      promoteId?: string | null;
      minzoom?: number | null;
      maxzoom?: number | null;
      bounds?: [number, number, number, number] | null;
    } | null;
  } | null;
};

export type CampaignMapManifestResult = {
  manifest: CampaignMapManifest | null;
  accessToken: string | null;
};

const MANIFEST_CACHE_TTL_MS = 5000;
const manifestCache = new Map<string, { expiresAt: number; result: CampaignMapManifestResult }>();
const manifestInFlight = new Map<string, Promise<CampaignMapManifestResult>>();

export function appendTileAccessToken(tileTemplate: string, accessToken?: string | null): string {
  if (!accessToken) return tileTemplate;
  const separator = tileTemplate.includes('?') ? '&' : '?';
  return `${tileTemplate}${separator}access_token=${encodeURIComponent(accessToken)}`;
}

export function isPmtilesGeometryProvider(provider: string | null | undefined): boolean {
  return Boolean(provider && (provider === 'pmtiles' || provider.startsWith('pmtiles_')));
}

export function hasRenderablePmtilesBuildings(manifest: CampaignMapManifest | null): boolean {
  if (!manifest) return false;
  if (manifest.buildings_render_mode === 'geojson') return false;

  return Boolean(
    isPmtilesGeometryProvider(manifest.geometry_provider) &&
      (
        manifest.vector_tile_url_template
      ) &&
      manifest.source_layers?.buildings
  );
}

export function hasRenderablePmtilesAddresses(manifest: CampaignMapManifest | null): boolean {
  if (!manifest) return false;
  if (manifest.buildings_render_mode === 'geojson') return false;

  const layer = manifest.layers?.addresses;
  const hasSeparateAddressTiles = Boolean(
    layer?.vectorTileUrlTemplate ||
      manifest.address_vector_tile_url_template
  );
  const addressSourceLayer =
    hasSeparateAddressTiles
      ? layer?.sourceLayer ?? manifest.address_source_layer ?? manifest.source_layers?.addresses
      : layer?.sourceLayer ??
        manifest.address_source_layer ??
        manifest.source_layers?.addresses;

  return Boolean(
    isPmtilesGeometryProvider(manifest.geometry_provider) &&
      (
        layer?.vectorTileUrlTemplate ||
        manifest.address_vector_tile_url_template ||
        manifest.vector_tile_url_template
      ) &&
      addressSourceLayer
  );
}

export function hasRenderablePmtilesParcels(manifest: CampaignMapManifest | null): boolean {
  if (!manifest) return false;
  const layer = manifest.layers?.parcels;

  return Boolean(
    isPmtilesGeometryProvider(manifest.geometry_provider) &&
      (
        layer?.vectorTileUrlTemplate ||
        manifest.parcel_vector_tile_url_template
      ) &&
      (layer?.sourceLayer || manifest.parcel_source_layer || manifest.source_layers?.parcels)
  );
}

export async function fetchCampaignMapManifest(campaignId: string): Promise<CampaignMapManifestResult> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;
  const cacheKey = `${campaignId}:${accessToken ?? ''}`;
  const cached = manifestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const existingRequest = manifestInFlight.get(cacheKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/map-geojson`, {
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    if (!response.ok) {
      console.warn('[CampaignMapManifest] Manifest unavailable:', response.status);
      return { manifest: null, accessToken };
    }

    return {
      manifest: (await response.json()) as CampaignMapManifest,
      accessToken,
    };
  })();

  manifestInFlight.set(cacheKey, request);
  try {
    const result = await request;
    manifestCache.set(cacheKey, {
      expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS,
      result,
    });
    return result;
  } finally {
    manifestInFlight.delete(cacheKey);
  }
}
