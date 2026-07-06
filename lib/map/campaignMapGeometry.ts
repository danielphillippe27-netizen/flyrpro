import { resolveArtifactUrl } from '@/lib/diamond/geometry';

export type CampaignMapGeometryStatus = 'pending' | 'ready' | 'partial' | 'failed';
export type CampaignMapGeometryProvider = 'diamond' | 'bedrock';
export type CampaignMapGeometryLayerKind = 'pmtiles' | 'geojson' | 'ndjson_gzip';

export type CampaignMapGeometryLayer = {
  kind: CampaignMapGeometryLayerKind;
  url: string;
  s3Key: string;
  sourceLayer?: string;
  promoteId?: string;
  minzoom?: number;
  maxzoom?: number;
  tilejsonKey?: string | null;
  tilejsonUrl?: string | null;
  vectorTileUrlTemplate?: string | null;
  bounds?: [number, number, number, number] | null;
};

export type CampaignMapGeometryResponse = {
  campaignId: string;
  campaign_id: string;
  status: CampaignMapGeometryStatus;
  provider: CampaignMapGeometryProvider;
  country?: string;
  countryCode?: string;
  regionCode?: string | null;
  layers: {
    buildings?: CampaignMapGeometryLayer;
    addresses?: CampaignMapGeometryLayer;
    parcels?: CampaignMapGeometryLayer;
  };
  issues: string[];

  // Compatibility fields consumed by the existing web and iOS map renderers.
  map_status: CampaignMapGeometryStatus;
  geometry_build_status: string;
  geometry_stage: string;
  geometry_stage_prefix: string | null;
  stale_geometry: boolean;
  geometry_build_reason: string | null;
  geometry_build_source: string | null;
  artifact_type: 'diamond' | 'white_gold' | 'basic';
  diamond_mode: boolean;
  geometry_provider: string | null;
  geometry_version: number | null;
  geometry_url: string | null;
  pmtiles_url: string | null;
  address_pmtiles_key: string | null;
  address_tilejson_key: string | null;
  address_pmtiles_url: string | null;
  address_tilejson_url: string | null;
  address_vector_tile_url_template: string | null;
  address_source_layer: string | null;
  address_promote_id: string | null;
  address_minzoom: number | null;
  address_maxzoom: number | null;
  geometry_etag: string | null;
  tilejson_url: string | null;
  vector_tile_url_template: string | null;
  parcel_pmtiles_key: string | null;
  parcel_tilejson_key: string | null;
  parcel_pmtiles_url: string | null;
  parcel_tilejson_url: string | null;
  parcel_vector_tile_url_template: string | null;
  parcel_source_layer: string | null;
  parcel_promote_id: string | null;
  parcel_minzoom: number | null;
  parcel_maxzoom: number | null;
  geometry_delivery_mode: 'backend_zxy' | 'address_points';
  supported_delivery_modes: string[];
  preferred_delivery_modes: {
    web: string;
    ios: string;
  };
  static_vector_tile_url_template: null;
  buildings_render_mode: 'vector_tiles' | 'geojson' | null;
  source_layers: {
    buildings: string | null;
    parcels: string | null;
    addresses: string | null;
    address_circles: string | null;
    address_building_links: string | null;
  };
  promote_ids: {
    buildings: string | null;
    parcels: string | null;
    addresses: string | null;
    address_circles: string | null;
    address_building_links: string | null;
  };
  join_key: string | null;
  primary_state_layer: string;
  bounds: [number, number, number, number] | null;
  minzoom: number | null;
  maxzoom: number | null;
  sources: Record<string, unknown>;
  state_source: 'supabase';
  state_cursor: string;
  supports_feature_state: boolean;
  supports_differential_state_sync: boolean;
  supports_rep_scope: boolean;
  fallback_geometry_provider: string | null;
};

export type CampaignMapSnapshotRow = {
  bucket: string;
  prefix: string | null;
  buildings_key: string | null;
  addresses_key?: string | null;
  buildings_url: string | null;
  addresses_url?: string | null;
  metadata_key: string | null;
  buildings_count: number | null;
  created_at: string | null;
  tile_metrics: Record<string, unknown> | null;
};

type BuildCampaignMapGeometryOptions = {
  campaignId: string;
  snapshot: CampaignMapSnapshotRow | null;
  campaign: {
    bbox?: unknown;
    region?: string | null;
    provision_status?: string | null;
  } | null;
  baseUrl: string;
  stateCursor: string;
};

function stringMetric(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberMetric(metrics: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function objectMetric(metrics: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const value = metrics?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boolMetric(metrics: Record<string, unknown> | null | undefined, key: string): boolean {
  return metrics?.[key] === true;
}

function geometryBuildFields(snapshot: CampaignMapSnapshotRow | null) {
  return {
    geometry_build_status: stringMetric(snapshot?.tile_metrics, 'geometry_build_status') ?? (snapshot ? 'ready' : 'pending'),
    geometry_stage: stringMetric(snapshot?.tile_metrics, 'geometry_stage') ?? 'production',
    geometry_stage_prefix: stringMetric(snapshot?.tile_metrics, 'geometry_stage_prefix'),
    stale_geometry: boolMetric(snapshot?.tile_metrics, 'stale_geometry'),
    geometry_build_reason: stringMetric(snapshot?.tile_metrics, 'geometry_build_reason'),
    geometry_build_source: stringMetric(snapshot?.tile_metrics, 'geometry_build_source'),
  };
}

function normalizeBounds(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bounds = value.map((entry) => Number(entry));
  if (!bounds.every(Number.isFinite)) return null;
  if (bounds[0] > bounds[2] || bounds[1] > bounds[3]) return null;
  return bounds as [number, number, number, number];
}

function layerKindForKey(key: string): CampaignMapGeometryLayerKind {
  if (/\.pmtiles$/i.test(key)) return 'pmtiles';
  if (/\.ndjson\.gz$/i.test(key)) return 'ndjson_gzip';
  return 'geojson';
}

function apiTileTemplate(baseUrl: string, campaignId: string, layer: 'buildings' | 'addresses' | 'parcels', cacheKey: string) {
  const encodedCampaignId = encodeURIComponent(campaignId);
  const encodedCacheKey = encodeURIComponent(cacheKey);
  if (layer === 'buildings') {
    return `${baseUrl}/api/campaigns/${encodedCampaignId}/diamond-tiles/buildings/{z}/{x}/{y}.mvt?v=${encodedCacheKey}`;
  }
  if (layer === 'addresses') {
    return `${baseUrl}/api/campaigns/${encodedCampaignId}/address-tiles/{z}/{x}/{y}.mvt?v=${encodedCacheKey}`;
  }
  return `${baseUrl}/api/campaigns/${encodedCampaignId}/parcel-tiles/{z}/{x}/{y}.mvt?v=${encodedCacheKey}`;
}

async function buildLayer(params: {
  snapshot: CampaignMapSnapshotRow;
  key: string | null;
  tilejsonKey?: string | null;
  sourceLayer?: string | null;
  promoteId?: string | null;
  minzoom?: number | null;
  maxzoom?: number | null;
  bounds?: [number, number, number, number] | null;
  vectorTileUrlTemplate?: string | null;
}): Promise<CampaignMapGeometryLayer | undefined> {
  if (!params.key) return undefined;
  const url = await resolveArtifactUrl(params.snapshot, params.key);
  const tilejsonUrl = params.tilejsonKey
    ? await resolveArtifactUrl(params.snapshot, params.tilejsonKey)
    : null;

  return {
    kind: layerKindForKey(params.key),
    url,
    s3Key: params.key,
    sourceLayer: params.sourceLayer ?? undefined,
    promoteId: params.promoteId ?? undefined,
    minzoom: params.minzoom ?? undefined,
    maxzoom: params.maxzoom ?? undefined,
    tilejsonKey: params.tilejsonKey ?? null,
    tilejsonUrl,
    vectorTileUrlTemplate: params.vectorTileUrlTemplate ?? null,
    bounds: params.bounds ?? null,
  };
}

function pendingResponse(options: BuildCampaignMapGeometryOptions): CampaignMapGeometryResponse {
  const failed = options.campaign?.provision_status === 'failed';
  const status: CampaignMapGeometryStatus = failed ? 'failed' : 'pending';
  const bounds = normalizeBounds(options.campaign?.bbox);

  return {
    campaignId: options.campaignId,
    campaign_id: options.campaignId,
    status,
    provider: 'diamond',
    regionCode: options.campaign?.region ?? null,
    layers: {},
    issues: failed ? ['campaign_provision_failed'] : ['campaign_geometry_pending'],
    map_status: status,
    ...geometryBuildFields(null),
    artifact_type: 'basic',
    diamond_mode: false,
    geometry_provider: 'address_points',
    geometry_version: null,
    geometry_url: null,
    pmtiles_url: null,
    address_pmtiles_key: null,
    address_tilejson_key: null,
    address_pmtiles_url: null,
    address_tilejson_url: null,
    address_vector_tile_url_template: null,
    address_source_layer: null,
    address_promote_id: null,
    address_minzoom: null,
    address_maxzoom: null,
    geometry_etag: null,
    tilejson_url: null,
    vector_tile_url_template: null,
    parcel_pmtiles_key: null,
    parcel_tilejson_key: null,
    parcel_pmtiles_url: null,
    parcel_tilejson_url: null,
    parcel_vector_tile_url_template: null,
    parcel_source_layer: null,
    parcel_promote_id: null,
    parcel_minzoom: null,
    parcel_maxzoom: null,
    geometry_delivery_mode: 'address_points',
    supported_delivery_modes: ['address_points'],
    preferred_delivery_modes: { web: 'address_points', ios: 'address_points' },
    static_vector_tile_url_template: null,
    buildings_render_mode: null,
    source_layers: {
      buildings: null,
      parcels: null,
      addresses: 'campaign_addresses',
      address_circles: null,
      address_building_links: null,
    },
    promote_ids: {
      buildings: null,
      parcels: null,
      addresses: 'address_id',
      address_circles: null,
      address_building_links: null,
    },
    join_key: 'address_id',
    primary_state_layer: 'addresses',
    bounds,
    minzoom: null,
    maxzoom: null,
    sources: { addresses: 'supabase' },
    state_source: 'supabase',
    state_cursor: options.stateCursor,
    supports_feature_state: false,
    supports_differential_state_sync: false,
    supports_rep_scope: false,
    fallback_geometry_provider: null,
  };
}

export async function buildCampaignMapGeometry(
  options: BuildCampaignMapGeometryOptions
): Promise<CampaignMapGeometryResponse> {
  const { campaignId, snapshot, campaign, baseUrl, stateCursor } = options;
  if (!snapshot) return pendingResponse(options);

  const metrics = snapshot.tile_metrics ?? {};
  const sourceLayers = objectMetric(metrics, 'source_layers');
  const promoteIds = objectMetric(metrics, 'promote_ids');
  const sources = objectMetric(metrics, 'sources');
  const provider: CampaignMapGeometryProvider = metrics.bedrock_mode === true ? 'bedrock' : 'diamond';
  const country =
    stringMetric(metrics, 'bedrock_country') ??
    stringMetric(metrics, 'diamond_country') ??
    undefined;
  const countryCode =
    stringMetric(metrics, 'bedrock_country_code') ??
    stringMetric(metrics, 'diamond_country_code') ??
    undefined;
  const bounds =
    normalizeBounds(metrics.bounds) ??
    normalizeBounds(metrics.address_bounds) ??
    normalizeBounds(campaign?.bbox);
  const geometryVersion =
    numberMetric(metrics, 'geometry_version') ??
    numberMetric(metrics, 'pmtiles_version') ??
    (snapshot.created_at ? Date.parse(snapshot.created_at) : null);
  const geometryEtag =
    stringMetric(metrics, 'pmtiles_etag') ??
    stringMetric(metrics, 'geometry_etag');
  const minzoom = numberMetric(metrics, 'minzoom') ?? 12;
  const maxzoom = numberMetric(metrics, 'maxzoom') ?? 18;
  const addressMinzoom = numberMetric(metrics, 'address_minzoom') ?? 10;
  const addressMaxzoom = numberMetric(metrics, 'address_maxzoom') ?? 16;
  const parcelMinzoom = numberMetric(metrics, 'parcel_minzoom') ?? 10;
  const parcelMaxzoom = numberMetric(metrics, 'parcel_maxzoom') ?? 16;

  const buildingPmtilesKey =
    stringMetric(metrics, 'pmtiles_key') ??
    (snapshot.buildings_key?.endsWith('.pmtiles') ? snapshot.buildings_key : null);
  const buildingGeojsonKey =
    stringMetric(metrics, 'buildings_geojson_key') ??
    stringMetric(metrics, 'geojson_key') ??
    (snapshot.buildings_key && !snapshot.buildings_key.endsWith('.pmtiles') ? snapshot.buildings_key : null);
  const usableBuildingKey = buildingPmtilesKey ?? buildingGeojsonKey;
  const hasScopedBuildingArtifact = Boolean(buildingPmtilesKey || buildingGeojsonKey);

  const addressPmtilesKey =
    stringMetric(metrics, 'addresses_pmtiles_key') ??
    (snapshot.addresses_key?.endsWith('.pmtiles') ? snapshot.addresses_key : null);
  const addressGeojsonKey =
    stringMetric(metrics, 'addresses_geojson_key') ??
    (snapshot.addresses_key && !snapshot.addresses_key.endsWith('.pmtiles') ? snapshot.addresses_key : null);
  const addressKey = addressPmtilesKey ?? addressGeojsonKey;
  const parcelPmtilesKey = stringMetric(metrics, 'parcels_pmtiles_key');
  const parcelGeojsonKey = stringMetric(metrics, 'parcels_geojson_key');
  const parcelKey = parcelPmtilesKey ?? parcelGeojsonKey;

  const buildingSourceLayer = stringMetric(sourceLayers, 'buildings') ?? 'buildings';
  const addressSourceLayer = stringMetric(sourceLayers, 'addresses') ?? (addressKey ? 'addresses' : null);
  const parcelSourceLayer = stringMetric(sourceLayers, 'parcels') ?? (parcelKey ? 'parcels' : null);
  const buildingPromoteId = 'building_id';
  const addressPromoteId = stringMetric(promoteIds, 'addresses') ?? 'address_id';
  const parcelPromoteId = stringMetric(promoteIds, 'parcels') ?? 'parcel_id';

  // Building artifacts are often municipality/country PMTiles. The campaign
  // render contract exposes only server-scoped building GeoJSON so clients do
  // not render a whole city tile and then rely on client-side filters.
  const scopedBuildingsUrl = `${baseUrl}/api/campaigns/${encodeURIComponent(campaignId)}/buildings`;
  const buildingVectorTemplate = null;
  const addressVectorTemplate =
    addressKey && addressKey.endsWith('.pmtiles')
      ? apiTileTemplate(baseUrl, campaignId, 'addresses', `${geometryEtag ?? geometryVersion ?? 'addresses'}:${addressKey}`)
      : null;
  const parcelVectorTemplate =
    parcelKey && parcelKey.endsWith('.pmtiles')
      ? apiTileTemplate(baseUrl, campaignId, 'parcels', `${geometryEtag ?? geometryVersion ?? 'parcels'}:${parcelKey}`)
      : null;

  const [buildings, addresses, parcels] = await Promise.all([
    buildLayer({
      snapshot,
      key: usableBuildingKey,
      tilejsonKey: stringMetric(metrics, 'tilejson_key') ?? usableBuildingKey?.replace(/\.pmtiles$/i, '.json') ?? null,
      sourceLayer: buildingSourceLayer,
      promoteId: buildingPromoteId,
      minzoom,
      maxzoom,
      bounds,
      vectorTileUrlTemplate: buildingVectorTemplate,
    }),
    buildLayer({
      snapshot,
      key: addressKey,
      tilejsonKey: stringMetric(metrics, 'addresses_tilejson_key') ?? addressPmtilesKey?.replace(/\.pmtiles$/i, '.json') ?? null,
      sourceLayer: addressSourceLayer,
      promoteId: addressPromoteId,
      minzoom: addressMinzoom,
      maxzoom: addressMaxzoom,
      bounds,
      vectorTileUrlTemplate: addressVectorTemplate,
    }),
    buildLayer({
      snapshot,
      key: parcelKey,
      tilejsonKey: stringMetric(metrics, 'parcels_tilejson_key') ?? parcelPmtilesKey?.replace(/\.pmtiles$/i, '.json') ?? null,
      sourceLayer: parcelSourceLayer,
      promoteId: parcelPromoteId,
      minzoom: parcelMinzoom,
      maxzoom: parcelMaxzoom,
      bounds,
      vectorTileUrlTemplate: parcelVectorTemplate,
    }),
  ]);

  const scopedBuildings = hasScopedBuildingArtifact
    ? {
        ...(buildings ?? {
          kind: 'geojson' as const,
          url: scopedBuildingsUrl,
          s3Key: buildingPmtilesKey ?? buildingGeojsonKey ?? '',
          sourceLayer: buildingSourceLayer,
          promoteId: buildingPromoteId,
          minzoom,
          maxzoom,
          bounds,
        }),
        kind: 'geojson' as const,
        url: scopedBuildingsUrl,
        tilejsonUrl: null,
        vectorTileUrlTemplate: null,
      }
    : undefined;

  const layers = {
    ...(scopedBuildings ? { buildings: scopedBuildings } : {}),
    ...(addresses ? { addresses } : {}),
    ...(parcels ? { parcels } : {}),
  };
  const hasBuildings = Boolean(scopedBuildings);
  const hasAddresses = Boolean(addresses);
  const status: CampaignMapGeometryStatus =
    hasBuildings && hasAddresses
      ? 'ready'
      : hasBuildings || hasAddresses || parcels
        ? 'partial'
        : campaign?.provision_status === 'failed'
          ? 'failed'
          : 'pending';
  const issues: string[] = [];
  if (!hasBuildings) issues.push('buildings_layer_unavailable');
  if (!hasAddresses) issues.push('addresses_layer_unavailable');
  if (buildingPmtilesKey && !usableBuildingKey && !hasScopedBuildingArtifact) {
    issues.push('buildings_pmtiles_missing');
  }

  const addressCircleLayer = addressSourceLayer;
  const geometryProvider =
    Object.values(layers).some((layer) => layer.kind === 'pmtiles')
      ? 'pmtiles'
      : Object.keys(layers).length > 0
        ? 'geojson'
        : 'address_points';

  return {
    campaignId,
    campaign_id: campaignId,
    status,
    provider,
    country,
    countryCode,
    regionCode: campaign?.region ?? null,
    layers,
    issues,
    map_status: status,
    ...geometryBuildFields(snapshot),
    artifact_type: 'diamond',
    diamond_mode: Object.keys(layers).length > 0,
    geometry_provider: geometryProvider,
    geometry_version: geometryVersion,
    geometry_url: scopedBuildings?.url ?? null,
    pmtiles_url: null,
    address_pmtiles_key: addressPmtilesKey,
    address_tilejson_key: addresses?.tilejsonKey ?? null,
    address_pmtiles_url: addresses?.kind === 'pmtiles' ? addresses.url : null,
    address_tilejson_url: addresses?.tilejsonUrl ?? null,
    address_vector_tile_url_template: addressVectorTemplate,
    address_source_layer: addressSourceLayer,
    address_promote_id: addressPromoteId,
    address_minzoom: hasAddresses ? addressMinzoom : null,
    address_maxzoom: hasAddresses ? addressMaxzoom : null,
    geometry_etag: geometryEtag,
    tilejson_url: null,
    vector_tile_url_template: buildingVectorTemplate,
    parcel_pmtiles_key: parcelPmtilesKey,
    parcel_tilejson_key: parcels?.tilejsonKey ?? null,
    parcel_pmtiles_url: parcels?.kind === 'pmtiles' ? parcels.url : null,
    parcel_tilejson_url: parcels?.tilejsonUrl ?? null,
    parcel_vector_tile_url_template: parcelVectorTemplate,
    parcel_source_layer: parcelSourceLayer,
    parcel_promote_id: parcelPromoteId,
    parcel_minzoom: parcels ? parcelMinzoom : null,
    parcel_maxzoom: parcels ? parcelMaxzoom : null,
    geometry_delivery_mode: geometryProvider === 'address_points' ? 'address_points' : 'backend_zxy',
    supported_delivery_modes: geometryProvider === 'address_points' ? ['address_points'] : ['backend_zxy'],
    preferred_delivery_modes: geometryProvider === 'address_points'
      ? { web: 'address_points', ios: 'address_points' }
      : { web: 'backend_zxy', ios: 'backend_zxy' },
    static_vector_tile_url_template: null,
    buildings_render_mode: scopedBuildings ? 'geojson' : null,
    source_layers: {
      buildings: hasBuildings ? buildingSourceLayer : null,
      parcels: parcels ? parcelSourceLayer : null,
      addresses: addressSourceLayer,
      address_circles: addressCircleLayer,
      address_building_links: stringMetric(sourceLayers, 'address_building_links'),
    },
    promote_ids: {
      buildings: hasBuildings ? buildingPromoteId : null,
      parcels: parcels ? parcelPromoteId : null,
      addresses: addressPromoteId,
      address_circles: addressPromoteId,
      address_building_links: stringMetric(promoteIds, 'address_building_links'),
    },
    join_key: stringMetric(metrics, 'join_key') ?? addressPromoteId,
    primary_state_layer: 'addresses',
    bounds,
    minzoom: hasBuildings ? minzoom : addressMinzoom,
    maxzoom: hasBuildings ? maxzoom : addressMaxzoom,
    sources: sources ?? {},
    state_source: 'supabase',
    state_cursor: stateCursor,
    supports_feature_state: Object.keys(layers).length > 0,
    supports_differential_state_sync: provider === 'diamond',
    supports_rep_scope: provider === 'diamond',
    fallback_geometry_provider: buildingGeojsonKey && buildingPmtilesKey ? 'geojson_snapshot' : null,
  };
}
