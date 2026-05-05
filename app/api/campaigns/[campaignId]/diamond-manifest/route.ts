import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import {
  type CampaignSnapshotRow,
  geometryCdnBaseUrl,
  resolveCampaignMapArtifact,
  resolveArtifactUrl,
  resolveGeometryEtag,
  resolveGeometryVersion,
} from '@/lib/diamond/geometry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

function deliveryModeResponse(options: {
  pmtilesCdnUrl: string | null;
  staticVectorTileUrlTemplate: string | null;
}) {
  const supportedDeliveryModes = [
    ...(options.pmtilesCdnUrl ? ['pmtiles_cdn'] : []),
    ...(options.staticVectorTileUrlTemplate ? ['static_zxy_cdn'] : []),
    'backend_zxy',
  ];

  return {
    geometry_delivery_mode: options.pmtilesCdnUrl ? 'platform_split' : 'backend_zxy',
    supported_delivery_modes: supportedDeliveryModes,
    preferred_delivery_modes: {
      web: options.pmtilesCdnUrl ? 'pmtiles_cdn' : 'backend_zxy',
      ios: 'backend_zxy',
    },
    static_vector_tile_url_template: options.staticVectorTileUrlTemplate,
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
    .select('id, bbox')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from('campaign_snapshots')
    .select('bucket, prefix, buildings_key, buildings_url, metadata_key, buildings_count, created_at, tile_metrics')
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

  if (!snapshotRow || artifact.geometryProvider === 'address_points' || !artifact.pmtilesKey) {
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

  const geometryUrl = await resolveArtifactUrl(snapshotRow, artifact.pmtilesKey);
  const artifactType = artifact.artifactType;
  const sourceLayers = objectMetric(snapshotRow.tile_metrics, 'source_layers');
  const promoteIds = objectMetric(snapshotRow.tile_metrics, 'promote_ids');
  const sources = objectMetric(snapshotRow.tile_metrics, 'sources');
  const minzoom = numberMetric(snapshotRow.tile_metrics, 'minzoom') ?? 13;
  const maxzoom = numberMetric(snapshotRow.tile_metrics, 'maxzoom') ?? 18;
  const bounds = snapshotRow.tile_metrics?.bounds;
  const geometryVersion = resolveGeometryVersion(snapshotRow);
  const geometryEtag = resolveGeometryEtag(snapshotRow);
  const tilejsonKey =
    typeof snapshotRow.tile_metrics?.tilejson_key === 'string'
      ? snapshotRow.tile_metrics.tilejson_key
      : artifact.pmtilesKey.replace(/\.pmtiles$/i, '.json');
  const tilejsonUrl = await resolveArtifactUrl(snapshotRow, tilejsonKey);
  const tileCacheKey = encodeURIComponent(String(geometryEtag ?? geometryVersion ?? artifact.pmtilesKey));
  const backendVectorTileUrlTemplate =
    `${baseUrl}/api/campaigns/${campaignId}/diamond-tiles/buildings/{z}/{x}/{y}.mvt?v=${tileCacheKey}`;
  const staticVectorTileUrlTemplate =
    stringMetric(snapshotRow.tile_metrics, 'static_vector_tile_url_template') ??
    stringMetric(snapshotRow.tile_metrics, 'vector_tile_cdn_url_template') ??
    null;
  const pmtilesCdnUrl = geometryCdnBaseUrl() ? geometryUrl : null;

  return NextResponse.json({
    campaign_id: campaignId,
    map_status: artifact.mapStatus,
    artifact_type: artifactType,
    diamond_mode: true,
    geometry_provider: artifact.geometryProvider,
    geometry_version: geometryVersion,
    geometry_url: geometryUrl,
    pmtiles_url: pmtilesCdnUrl,
    geometry_etag: geometryEtag,
    tilejson_url: tilejsonUrl,
    vector_tile_url_template: backendVectorTileUrlTemplate,
    ...deliveryModeResponse({
      pmtilesCdnUrl,
      staticVectorTileUrlTemplate,
    }),
    source_layers: {
      buildings: stringMetric(sourceLayers, 'buildings') ?? 'buildings',
      parcels: stringMetric(sourceLayers, 'parcels') ?? (artifactType === 'white_gold' ? null : 'parcels'),
      addresses: stringMetric(sourceLayers, 'addresses'),
      address_circles: stringMetric(sourceLayers, 'address_circles'),
      address_building_links: stringMetric(sourceLayers, 'address_building_links'),
    },
    promote_ids: {
      buildings: stringMetric(promoteIds, 'buildings') ?? 'address_id',
      parcels: stringMetric(promoteIds, 'parcels') ?? (artifactType === 'white_gold' ? null : 'parcel_id'),
      addresses: stringMetric(promoteIds, 'addresses'),
      address_circles: stringMetric(promoteIds, 'address_circles'),
      address_building_links: stringMetric(promoteIds, 'address_building_links'),
    },
    join_key: stringMetric(snapshotRow.tile_metrics, 'join_key') ?? 'address_id',
    primary_state_layer: 'buildings',
    bounds: Array.isArray(bounds) ? bounds : (campaign as { bbox?: unknown }).bbox ?? null,
    minzoom,
    maxzoom,
    sources: sources ?? {
      buildings: artifactType === 'white_gold' ? 'overture' : 'diamond',
      addresses: artifactType === 'white_gold' ? 'netsyms' : 'supabase',
    },
    state_source: 'supabase',
    state_cursor: stateCursor,
    supports_feature_state: true,
    supports_differential_state_sync: artifactType !== 'white_gold',
    supports_rep_scope: artifactType !== 'white_gold',
    fallback_geometry_provider: artifact.fallbackGeojsonKey ? 'geojson_snapshot' : null,
  });
}
