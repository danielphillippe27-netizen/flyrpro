import { createClient } from '@/lib/supabase/client';

export type CampaignMapManifest = {
  artifact_type?: 'diamond' | 'white_gold' | 'basic';
  geometry_provider?: string | null;
  geometry_delivery_mode?: string | null;
  supported_delivery_modes?: string[] | null;
  preferred_delivery_modes?: {
    web?: string | null;
    ios?: string | null;
  } | null;
  pmtiles_url?: string | null;
  vector_tile_url_template?: string | null;
  static_vector_tile_url_template?: string | null;
  parcel_pmtiles_key?: string | null;
  parcel_tilejson_key?: string | null;
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
};

export type CampaignMapManifestResult = {
  manifest: CampaignMapManifest | null;
  accessToken: string | null;
};

export function appendTileAccessToken(tileTemplate: string, accessToken?: string | null): string {
  if (!accessToken) return tileTemplate;
  const separator = tileTemplate.includes('?') ? '&' : '?';
  return `${tileTemplate}${separator}access_token=${encodeURIComponent(accessToken)}`;
}

export function isPmtilesGeometryProvider(provider: string | null | undefined): boolean {
  return Boolean(provider && (provider === 'pmtiles' || provider.startsWith('pmtiles_')));
}

export function toPmtilesProtocolUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('pmtiles://')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return `pmtiles://${trimmed}`;
  return null;
}

export function hasDirectWebPmtiles(manifest: CampaignMapManifest | null): boolean {
  if (!manifest) return false;

  return Boolean(
    isPmtilesGeometryProvider(manifest.geometry_provider) &&
      toPmtilesProtocolUrl(manifest.pmtiles_url) &&
      manifest.supported_delivery_modes?.includes('pmtiles_cdn') &&
      manifest.preferred_delivery_modes?.web === 'pmtiles_cdn'
  );
}

export function hasRenderablePmtilesBuildings(manifest: CampaignMapManifest | null): boolean {
  if (!manifest) return false;

  return Boolean(
    isPmtilesGeometryProvider(manifest.geometry_provider) &&
      (hasDirectWebPmtiles(manifest) || manifest.static_vector_tile_url_template || manifest.vector_tile_url_template) &&
      manifest.source_layers?.buildings
  );
}

export function hasRenderablePmtilesAddresses(manifest: CampaignMapManifest | null): boolean {
  if (!manifest) return false;

  return Boolean(
    isPmtilesGeometryProvider(manifest.geometry_provider) &&
      (hasDirectWebPmtiles(manifest) || manifest.static_vector_tile_url_template || manifest.vector_tile_url_template) &&
      manifest.source_layers?.addresses
  );
}

export async function fetchCampaignMapManifest(campaignId: string): Promise<CampaignMapManifestResult> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;

  const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/diamond-manifest`, {
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
}
