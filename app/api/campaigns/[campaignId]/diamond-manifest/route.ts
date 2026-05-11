import { NextRequest, NextResponse } from 'next/server';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import {
  type CampaignSnapshotRow,
  type ParcelPmtilesResolution,
  resolveCampaignMapArtifact,
  resolveGeometryEtag,
  resolveGeometryVersion,
} from '@/lib/diamond/geometry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let s3Client: S3Client | null = null;

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-2',
      credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
    });
  }

  return s3Client;
}

function apiBaseUrl(request: NextRequest) {
  const configured = request.nextUrl.origin.replace(/\/+$/, '');

  return configured === 'https://flyrpro.app'
    ? 'https://www.flyrpro.app'
    : configured;
}

async function latestCursor(supabase: ReturnType<typeof createAdminClient>, campaignId: string) {
  let cursor: string | null = null;

  const { data: addressRows } = await supabase
    .from('campaign_addresses')
    .select('updated_at')
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: false })
    .limit(1);

  const addressCursor = Array.isArray(addressRows)
    ? (addressRows[0] as { updated_at?: string } | undefined)?.updated_at ?? null
    : null;
  if (addressCursor) cursor = addressCursor;

  const { data: statusRows } = await supabase
    .from('address_statuses')
    .select('updated_at')
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: false })
    .limit(1);

  const statusCursor = Array.isArray(statusRows)
    ? (statusRows[0] as { updated_at?: string } | undefined)?.updated_at ?? null
    : null;
  if (statusCursor && (!cursor || Date.parse(statusCursor) > Date.parse(cursor))) {
    cursor = statusCursor;
  }

  return cursor ?? new Date().toISOString();
}

function stringMetric(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function objectMetric(metrics: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const value = metrics?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberMetric(metrics: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function currentObjectVersion(bucket: string, key: string) {
  try {
    const response = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const etag = response.ETag?.replace(/^"|"$/g, '');
    const updatedAt = response.LastModified?.getTime();
    return [etag, updatedAt].filter(Boolean).join(':') || null;
  } catch (error) {
    console.warn('[DiamondManifest] Failed to read artifact version:', {
      bucket,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function deliveryModeResponse() {
  return {
    geometry_delivery_mode: 'backend_zxy',
    supported_delivery_modes: ['backend_zxy'],
    preferred_delivery_modes: {
      web: 'backend_zxy',
      ios: 'backend_zxy',
    },
    static_vector_tile_url_template: null,
  };
}

function parcelTilesFromSnapshot(snapshot: CampaignSnapshotRow): ParcelPmtilesResolution | null {
  const metricParcelPmtilesKey = stringMetric(snapshot.tile_metrics, 'parcels_pmtiles_key');
  const metricParcelTilejsonKey =
    stringMetric(snapshot.tile_metrics, 'parcels_tilejson_key') ??
    metricParcelPmtilesKey?.replace(/\.pmtiles$/i, '.json') ??
    null;

  if (metricParcelPmtilesKey) {
    return {
      bucket: snapshot.bucket,
      pmtilesKey: metricParcelPmtilesKey,
      tilejsonKey: metricParcelTilejsonKey ?? metricParcelPmtilesKey.replace(/\.pmtiles$/i, '.json'),
      datePart: 'snapshot',
      sourceLayer: 'parcels',
      promoteId: 'parcel_id',
      minzoom: numberMetric(snapshot.tile_metrics, 'parcel_minzoom') ?? 10,
      maxzoom: numberMetric(snapshot.tile_metrics, 'parcel_maxzoom') ?? 16,
    };
  }

  const buildingPmtilesKey = resolveCampaignMapArtifact(snapshot).pmtilesKey;
  const isBedrockNzSnapshot =
    snapshot.tile_metrics?.bedrock_mode === true &&
    stringMetric(snapshot.tile_metrics, 'bedrock_country_code') === 'NZ' &&
    buildingPmtilesKey?.endsWith('/buildings/buildings.pmtiles');

  if (!isBedrockNzSnapshot || !buildingPmtilesKey) return null;

  const pmtilesKey = buildingPmtilesKey.replace(/\/buildings\/buildings\.pmtiles$/i, '/parcels/parcels.pmtiles');
  return {
    bucket: snapshot.bucket,
    pmtilesKey,
    tilejsonKey: pmtilesKey.replace(/\.pmtiles$/i, '.json'),
    datePart: 'snapshot',
    sourceLayer: 'parcels',
    promoteId: 'parcel_id',
    minzoom: numberMetric(snapshot.tile_metrics, 'parcel_minzoom') ?? 10,
    maxzoom: numberMetric(snapshot.tile_metrics, 'parcel_maxzoom') ?? 16,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const allowed = await ensureCampaignAccess(supabase, campaignId, requestUser.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, bbox, region')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from('campaign_snapshots')
    .select('bucket, prefix, buildings_key, addresses_key, buildings_url, metadata_key, buildings_count, created_at, tile_metrics')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (snapshotError) {
    return NextResponse.json(
      { error: 'Failed to load campaign geometry snapshot', details: snapshotError.message },
      { status: 500 }
    );
  }

  const snapshotRow = snapshot as CampaignSnapshotRow | null;
  const artifact = resolveCampaignMapArtifact(snapshotRow);
  const stateCursor = await latestCursor(supabase, campaignId);
  const baseUrl = apiBaseUrl(request);
  const basicAddressPmtilesKey =
    stringMetric(snapshotRow?.tile_metrics, 'addresses_pmtiles_key') ??
    (snapshotRow?.addresses_key?.endsWith('.pmtiles') ? snapshotRow.addresses_key : null);
  const basicAddressTilejsonKey =
    stringMetric(snapshotRow?.tile_metrics, 'addresses_tilejson_key') ??
    basicAddressPmtilesKey?.replace(/\.pmtiles$/i, '.json') ??
    null;

  if (!snapshotRow || (artifact.geometryProvider === 'address_points' && !basicAddressPmtilesKey) || (!artifact.pmtilesKey && !basicAddressPmtilesKey)) {
    return NextResponse.json({
      campaign_id: campaignId,
      map_status: artifact.mapStatus,
      artifact_type: 'basic',
      diamond_mode: false,
      geometry_provider: 'address_points',
      geometry_version: null,
      geometry_url: null,
      pmtiles_url: null,
      geometry_etag: null,
      tilejson_url: null,
      vector_tile_url_template: null,
      geometry_delivery_mode: 'address_points',
      supported_delivery_modes: ['address_points'],
      preferred_delivery_modes: {
        web: 'address_points',
        ios: 'address_points',
      },
      static_vector_tile_url_template: null,
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
      bounds: (campaign as { bbox?: unknown }).bbox ?? null,
      minzoom: null,
      maxzoom: null,
      sources: {
        buildings: null,
        addresses: 'supabase',
      },
      state_source: 'supabase',
      state_cursor: stateCursor,
      supports_feature_state: false,
      supports_differential_state_sync: false,
      supports_rep_scope: false,
      fallback_geometry_provider: null,
    });
  }

  if (!artifact.pmtilesKey && basicAddressPmtilesKey) {
    const sourceLayers = objectMetric(snapshotRow.tile_metrics, 'source_layers');
    const promoteIds = objectMetric(snapshotRow.tile_metrics, 'promote_ids');
    const sources = objectMetric(snapshotRow.tile_metrics, 'sources');
    const bounds = snapshotRow.tile_metrics?.address_bounds ?? snapshotRow.tile_metrics?.bounds;
    const geometryVersion = resolveGeometryVersion(snapshotRow);
    const geometryEtag = resolveGeometryEtag(snapshotRow);
    const addressPmtilesUrl = null;
    const addressTilejsonUrl = null;
    const addressTileCacheKey = encodeURIComponent(`${geometryEtag ?? geometryVersion ?? 'address'}:${basicAddressPmtilesKey}`);
    const addressVectorTileUrlTemplate =
      `${baseUrl}/api/campaigns/${campaignId}/address-tiles/{z}/{x}/{y}.mvt?v=${addressTileCacheKey}`;

    return NextResponse.json({
      campaign_id: campaignId,
      map_status: artifact.mapStatus,
      artifact_type: 'diamond',
      diamond_mode: true,
      geometry_provider: 'pmtiles_addresses',
      geometry_version: geometryVersion,
      geometry_url: null,
      pmtiles_url: null,
      address_pmtiles_key: basicAddressPmtilesKey,
      address_tilejson_key: basicAddressTilejsonKey,
      address_pmtiles_url: addressPmtilesUrl,
      address_tilejson_url: addressTilejsonUrl,
      address_vector_tile_url_template: addressVectorTileUrlTemplate,
      address_source_layer: stringMetric(sourceLayers, 'addresses') ?? 'addresses',
      address_promote_id: stringMetric(promoteIds, 'addresses') ?? 'address_detail_pid',
      address_minzoom: numberMetric(snapshotRow.tile_metrics, 'address_minzoom') ?? 8,
      address_maxzoom: numberMetric(snapshotRow.tile_metrics, 'address_maxzoom') ?? 16,
      address_bounds: Array.isArray(bounds) ? bounds : (campaign as { bbox?: unknown }).bbox ?? null,
      geometry_etag: geometryEtag,
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
      geometry_delivery_mode: 'backend_zxy',
      supported_delivery_modes: ['backend_zxy'],
      preferred_delivery_modes: {
        web: 'backend_zxy',
        ios: 'backend_zxy',
      },
      static_vector_tile_url_template: null,
      source_layers: {
        buildings: null,
        parcels: null,
        addresses: stringMetric(sourceLayers, 'addresses') ?? 'addresses',
        address_circles: null,
        address_building_links: null,
      },
      layers: {
        buildings: null,
        addresses: {
          url: addressPmtilesUrl,
          vectorTileUrlTemplate: addressVectorTileUrlTemplate,
          sourceLayer: stringMetric(sourceLayers, 'addresses') ?? 'addresses',
          promoteId:
            stringMetric(promoteIds, 'addresses') ??
            'address_detail_pid',
          minzoom: numberMetric(snapshotRow.tile_metrics, 'address_minzoom') ?? 8,
          maxzoom: numberMetric(snapshotRow.tile_metrics, 'address_maxzoom') ?? 16,
          bounds: Array.isArray(bounds) ? bounds : (campaign as { bbox?: unknown }).bbox ?? null,
        },
        parcels: null,
      },
      promote_ids: {
        buildings: null,
        parcels: null,
        addresses: stringMetric(promoteIds, 'addresses') ?? 'address_detail_pid',
        address_circles: null,
        address_building_links: null,
      },
      join_key: stringMetric(snapshotRow.tile_metrics, 'join_key') ?? 'address_detail_pid',
      primary_state_layer: 'addresses',
      bounds: Array.isArray(bounds) ? bounds : (campaign as { bbox?: unknown }).bbox ?? null,
      minzoom: numberMetric(snapshotRow.tile_metrics, 'address_minzoom') ?? 8,
      maxzoom: numberMetric(snapshotRow.tile_metrics, 'address_maxzoom') ?? 16,
      sources: sources ?? {
        addresses: 'G-NAF',
      },
      state_source: 'supabase',
      state_cursor: stateCursor,
      supports_feature_state: true,
      supports_differential_state_sync: true,
      supports_rep_scope: true,
      fallback_geometry_provider: null,
    });
  }

  const pmtilesKey = artifact.pmtilesKey;
  if (!pmtilesKey) {
    return NextResponse.json({ error: 'No PMTiles artifact exists for this campaign' }, { status: 404 });
  }

  const geometryUrl = null;
  const artifactType = artifact.artifactType;
  const sourceLayers = objectMetric(snapshotRow.tile_metrics, 'source_layers');
  const promoteIds = objectMetric(snapshotRow.tile_metrics, 'promote_ids');
  const sources = objectMetric(snapshotRow.tile_metrics, 'sources');
  const minzoom = numberMetric(snapshotRow.tile_metrics, 'minzoom') ?? 13;
  const maxzoom = numberMetric(snapshotRow.tile_metrics, 'maxzoom') ?? 18;
  const bounds = snapshotRow.tile_metrics?.bounds;
  const geometryVersion = resolveGeometryVersion(snapshotRow);
  const geometryEtag = resolveGeometryEtag(snapshotRow);
  const tilejsonUrl = null;
  const addressPmtilesKey =
    stringMetric(snapshotRow.tile_metrics, 'addresses_pmtiles_key') ??
    (snapshotRow.addresses_key?.endsWith('.pmtiles') ? snapshotRow.addresses_key : null);
  const addressTilejsonKey =
    stringMetric(snapshotRow.tile_metrics, 'addresses_tilejson_key') ??
    addressPmtilesKey?.replace(/\.pmtiles$/i, '.json') ??
    null;
  const addressPmtilesUrl = null;
  const addressTilejsonUrl = null;
  const currentGeometryObjectVersion = await currentObjectVersion(snapshotRow.bucket, pmtilesKey);
  const currentGeometryCacheKey =
    currentGeometryObjectVersion ?? String(geometryEtag ?? geometryVersion ?? pmtilesKey);
  const tileCacheKey = encodeURIComponent(currentGeometryCacheKey);
  const backendVectorTileUrlTemplate =
    `${baseUrl}/api/campaigns/${campaignId}/diamond-tiles/buildings/{z}/{x}/{y}.mvt?v=${tileCacheKey}`;
  const addressTileCacheKey = addressPmtilesKey
    ? encodeURIComponent(`${geometryEtag ?? geometryVersion ?? 'address'}:${addressPmtilesKey}`)
    : null;
  const addressVectorTileUrlTemplate = addressPmtilesKey
    ? `${baseUrl}/api/campaigns/${campaignId}/address-tiles/{z}/{x}/{y}.mvt?v=${addressTileCacheKey}`
    : null;
  const parcelTiles = parcelTilesFromSnapshot(snapshotRow);
  const parcelPmtilesUrl = null;
  const parcelTilejsonUrl = null;
  const parcelTileCacheKey = parcelTiles
    ? encodeURIComponent(`${parcelTiles.datePart}:${parcelTiles.pmtilesKey}`)
    : null;
  const parcelVectorTileUrlTemplate = parcelTiles
    ? `${baseUrl}/api/campaigns/${campaignId}/parcel-tiles/{z}/{x}/{y}.mvt?v=${parcelTileCacheKey}`
    : null;
  const renderAddressSourceLayer =
    stringMetric(sourceLayers, 'addresses') ??
    (addressPmtilesKey ? 'addresses' : null);
  const renderAddressPromoteId =
    stringMetric(promoteIds, 'addresses') ??
    (addressPmtilesKey ? 'address_id' : null);

  return NextResponse.json({
    campaign_id: campaignId,
    map_status: artifact.mapStatus,
    artifact_type: artifactType,
    diamond_mode: true,
    geometry_provider: artifact.geometryProvider,
    geometry_version: geometryVersion,
    geometry_url: geometryUrl,
    pmtiles_url: null,
    address_pmtiles_key: addressPmtilesKey,
    address_tilejson_key: addressTilejsonKey,
    address_pmtiles_url: addressPmtilesUrl,
    address_tilejson_url: addressTilejsonUrl,
    address_vector_tile_url_template: addressVectorTileUrlTemplate,
    address_source_layer: renderAddressSourceLayer,
    address_promote_id: renderAddressPromoteId,
    address_minzoom: numberMetric(snapshotRow.tile_metrics, 'address_minzoom') ?? (addressPmtilesKey ? 10 : null),
    address_maxzoom: numberMetric(snapshotRow.tile_metrics, 'address_maxzoom') ?? (addressPmtilesKey ? 16 : null),
    geometry_etag: geometryEtag,
    tilejson_url: tilejsonUrl,
    vector_tile_url_template: backendVectorTileUrlTemplate,
    parcel_pmtiles_key: parcelTiles?.pmtilesKey ?? null,
    parcel_tilejson_key: parcelTiles?.tilejsonKey ?? null,
    parcel_pmtiles_url: parcelPmtilesUrl,
    parcel_tilejson_url: parcelTilejsonUrl,
    parcel_vector_tile_url_template: parcelVectorTileUrlTemplate,
    parcel_source_layer: parcelTiles?.sourceLayer ?? null,
    parcel_promote_id: parcelTiles?.promoteId ?? null,
    parcel_minzoom: parcelTiles?.minzoom ?? null,
    parcel_maxzoom: parcelTiles?.maxzoom ?? null,
    ...deliveryModeResponse(),
    source_layers: {
      buildings: stringMetric(sourceLayers, 'buildings') ?? 'buildings',
      parcels: stringMetric(sourceLayers, 'parcels') ?? (parcelTiles ? parcelTiles.sourceLayer : null),
      addresses: stringMetric(sourceLayers, 'addresses'),
      address_circles: null,
      address_building_links: stringMetric(sourceLayers, 'address_building_links'),
    },
    layers: {
      buildings: {
        url: null,
        vectorTileUrlTemplate: backendVectorTileUrlTemplate,
        sourceLayer: stringMetric(sourceLayers, 'buildings') ?? 'buildings',
        promoteId: stringMetric(promoteIds, 'buildings') ?? 'building_id',
        minzoom,
        maxzoom,
        bounds: Array.isArray(bounds) ? bounds : (campaign as { bbox?: unknown }).bbox ?? null,
      },
      addresses: addressPmtilesKey
        ? {
            url: addressPmtilesUrl,
            vectorTileUrlTemplate: addressVectorTileUrlTemplate,
            sourceLayer: renderAddressSourceLayer ?? 'addresses',
            promoteId: renderAddressPromoteId ?? 'address_id',
            minzoom: numberMetric(snapshotRow.tile_metrics, 'address_minzoom') ?? 10,
            maxzoom: numberMetric(snapshotRow.tile_metrics, 'address_maxzoom') ?? 16,
            bounds: Array.isArray(bounds) ? bounds : (campaign as { bbox?: unknown }).bbox ?? null,
          }
        : null,
      parcels: parcelTiles
        ? {
            url: parcelPmtilesUrl,
            vectorTileUrlTemplate: parcelVectorTileUrlTemplate,
            sourceLayer: parcelTiles.sourceLayer,
            promoteId: parcelTiles.promoteId,
            minzoom: parcelTiles.minzoom,
            maxzoom: parcelTiles.maxzoom,
            bounds: Array.isArray(bounds) ? bounds : (campaign as { bbox?: unknown }).bbox ?? null,
          }
        : null,
    },
    promote_ids: {
      buildings: stringMetric(promoteIds, 'buildings') ?? 'building_id',
      parcels: stringMetric(promoteIds, 'parcels') ?? (parcelTiles ? parcelTiles.promoteId : null),
      addresses: stringMetric(promoteIds, 'addresses'),
      address_circles: null,
      address_building_links: stringMetric(promoteIds, 'address_building_links'),
    },
    join_key: stringMetric(snapshotRow.tile_metrics, 'join_key') ?? 'address_id',
    primary_state_layer: 'buildings',
    bounds: Array.isArray(bounds) ? bounds : (campaign as { bbox?: unknown }).bbox ?? null,
    minzoom,
    maxzoom,
    sources: {
      ...(sources ?? {
        buildings: artifactType === 'white_gold' ? 'overture' : 'diamond',
        addresses: artifactType === 'white_gold' ? 'netsyms' : 'supabase',
      }),
      ...(parcelTiles ? { parcels: 'landrecords_pmtiles' } : {}),
    },
    state_source: 'supabase',
    state_cursor: stateCursor,
    supports_feature_state: true,
    supports_differential_state_sync: artifactType !== 'white_gold',
    supports_rep_scope: artifactType !== 'white_gold',
    fallback_geometry_provider: artifact.fallbackGeojsonKey ? 'geojson_snapshot' : null,
  });
}
