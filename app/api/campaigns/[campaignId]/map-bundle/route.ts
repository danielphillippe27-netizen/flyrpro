import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import {
  fetchScopedPmtilesBuildingFeatures,
  type ScopedBuildingFeatureCollection,
} from '@/app/api/campaigns/_utils/scoped-pmtiles-buildings';
import {
  bboxFromPositions,
  fetchScopedPmtilesParcels,
  flattenPositions,
  normalizeParcelGeoJsonPolygon,
  parcelTilesFromSnapshot,
  parseParcelBbox,
  type CampaignParcelResponse,
} from '@/app/api/campaigns/_utils/scoped-pmtiles-parcels';
import { inferProvisionSourceFromSnapshot } from '@/lib/campaigns/inferProvisionSource';
import type { CampaignSnapshotRow } from '@/lib/diamond/geometry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withNoStore(init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return { ...init, headers };
}

function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, withNoStore(init));
}

function normalizeBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every(Number.isFinite)) return null;
  if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) return null;
  return bbox as [number, number, number, number];
}

function normalizePolygon(value: unknown): GeoJSON.Polygon | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return normalizePolygon(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Polygon' &&
    Array.isArray((value as { coordinates?: unknown }).coordinates)
  ) {
    return value as GeoJSON.Polygon;
  }
  return null;
}

function featureCollectionCount(value: unknown): number {
  const features = (value as { features?: unknown } | null | undefined)?.features;
  return Array.isArray(features) ? features.length : 0;
}

function parseGeometry(value: unknown): GeoJSON.Geometry | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return parseGeometry(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object') return null;
  const geometry = value as GeoJSON.Geometry;
  return typeof geometry.type === 'string' ? geometry : null;
}

function parcelRowsToFeatureCollection(rows: CampaignParcelResponse[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.flatMap((row) => {
      const geometry = parseGeometry(row.geom);
      if (!geometry) return [];
      const properties = row.properties ?? {};
      const externalId = row.external_id || row.id;
      return [{
        id: externalId,
        type: 'Feature' as const,
        geometry,
        properties: {
          ...properties,
          id: row.id,
          parcel_id: (properties.parcel_id as string | undefined) ?? externalId,
          external_id: externalId,
          source: (properties.source as string | undefined) ?? 'campaign_parcels',
        },
      }];
    }),
  };
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedWorkflowStatus(value: unknown): string | null {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!status) return null;
  if (status === 'ok' || status === 'linked' || status === 'complete') return 'ready';
  if (status === 'fresh' || status === 'ready') return status;
  return status;
}

async function maybeAttachCanonicalMetadata(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  bundle: Record<string, unknown>
) {
  let sourceVersion: string | null = null;
  let assetSignature: string | null = null;
  let linksStatus: string | null = null;

  try {
    const { data } = await supabase.rpc('rpc_get_campaign_map_source_version', {
      p_campaign_id: campaignId,
    });
    const source = data as { source_version?: unknown; link_source_version?: unknown } | null;
    sourceVersion =
      typeof source?.source_version === 'string'
        ? source.source_version
        : typeof source?.link_source_version === 'string'
          ? source.link_source_version
          : null;
  } catch {
    // Older web deployments may not have the canonical source-version RPC yet.
  }

  try {
    const { data } = await supabase
      .from('campaign_map_bundles')
      .select('asset_signature, source_version, links_status')
      .eq('campaign_id', campaignId)
      .eq('is_current', true)
      .maybeSingle();

    const current = data as {
      asset_signature?: unknown;
      source_version?: unknown;
      links_status?: unknown;
    } | null;
    assetSignature = typeof current?.asset_signature === 'string' ? current.asset_signature : assetSignature;
    sourceVersion = typeof current?.source_version === 'string' ? current.source_version : sourceVersion;
    linksStatus = normalizedWorkflowStatus(current?.links_status) ?? linksStatus;
  } catch {
    // The legacy Flyr Pro app can run before the canonical bundle table exists.
  }

  const counts = (bundle.counts && typeof bundle.counts === 'object' ? bundle.counts : {}) as Record<string, unknown>;
  sourceVersion ??= stableHash({
    campaign_id: campaignId,
    updated_at: bundle.updated_at ?? null,
    counts,
  });
  assetSignature ??= stableHash({
    campaign_id: campaignId,
    source_version: sourceVersion,
    counts,
  });
  linksStatus ??= 'ready';

  bundle.source_version = sourceVersion;
  bundle.asset_signature = assetSignature;
  bundle.links_status = linksStatus;
  bundle.counts = {
    ...counts,
    source_version: sourceVersion,
    asset_signature: assetSignature,
    links_status: linksStatus,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const allowed = await ensureCampaignAccess(supabase, campaignId, requestUser.id);
  if (!allowed) {
    return json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const [{ data: snapshot }, { data: campaignRow }] = await Promise.all([
    supabase
      .from('campaign_snapshots')
      .select('bucket, prefix, buildings_key, buildings_url, metadata_key, buildings_count, created_at, tile_metrics')
      .eq('campaign_id', campaignId)
      .maybeSingle(),
    supabase
      .from('campaigns')
      .select('provision_source, region, bbox, territory_boundary')
      .eq('id', campaignId)
      .maybeSingle(),
  ]);

  if (campaignRow && !campaignRow.provision_source && snapshot) {
    const inferredSource = inferProvisionSourceFromSnapshot(snapshot, campaignRow.region);
    if (inferredSource) {
      await supabase
        .from('campaigns')
        .update({ provision_source: inferredSource })
        .eq('id', campaignId);
    }
  }

  const { data, error } = await supabase.rpc('rpc_get_campaign_map_bundle', {
    p_campaign_id: campaignId,
  });

  if (error) {
    return json(
      {
        error: 'Failed to load campaign map bundle',
        details: error.message,
      },
      { status: 500 }
    );
  }

  const bundle = data ?? {
    campaign_id: campaignId,
    status: 'pending',
    phase: 'pending',
    map_ready: false,
    addresses: { type: 'FeatureCollection', features: [] },
    buildings: { type: 'FeatureCollection', features: [] },
    parcels: { type: 'FeatureCollection', features: [] },
    roads: { type: 'FeatureCollection', features: [] },
    counts: { addresses: 0, buildings: 0, parcels: 0, roads: 0 },
  };

  if (featureCollectionCount((bundle as { buildings?: unknown }).buildings) === 0 && snapshot?.bucket) {
    const bbox = normalizeBbox(campaignRow?.bbox);
    if (bbox) {
      try {
        const scopedBuildings = await fetchScopedPmtilesBuildingFeatures(
          snapshot as CampaignSnapshotRow,
          bbox,
          new Set(),
          normalizePolygon(campaignRow?.territory_boundary)
        );

        if (scopedBuildings?.features.length) {
          const nextBundle = bundle as {
            buildings?: ScopedBuildingFeatureCollection;
            counts?: Record<string, number>;
          };
          nextBundle.buildings = scopedBuildings;
          nextBundle.counts = {
            ...(nextBundle.counts ?? {}),
            buildings: scopedBuildings.features.length,
          };
        }
      } catch (buildingsError) {
        console.warn(
          '[map-bundle] Failed to hydrate scoped snapshot buildings:',
          buildingsError instanceof Error ? buildingsError.message : buildingsError
        );
      }
    }
  }

  if (featureCollectionCount((bundle as { parcels?: unknown }).parcels) === 0 && snapshot?.bucket) {
    const bbox = parseParcelBbox(campaignRow?.bbox);
    const boundary = normalizeParcelGeoJsonPolygon(campaignRow?.territory_boundary);
    const scopeBbox = bbox ?? (boundary ? bboxFromPositions(flattenPositions(boundary)) : null);
    const parcelTiles = parcelTilesFromSnapshot(snapshot as CampaignSnapshotRow);
    if (scopeBbox && parcelTiles) {
      try {
        const scopedParcels = await fetchScopedPmtilesParcels(
          campaignId,
          snapshot as CampaignSnapshotRow,
          parcelTiles,
          scopeBbox,
          boundary
        );

        if (scopedParcels.parcels.length) {
          const parcelFeatures = parcelRowsToFeatureCollection(scopedParcels.parcels);
          const nextBundle = bundle as {
            parcels?: GeoJSON.FeatureCollection;
            counts?: Record<string, number>;
          };
          nextBundle.parcels = parcelFeatures;
          nextBundle.counts = {
            ...(nextBundle.counts ?? {}),
            parcels: parcelFeatures.features.length,
          };
        }
      } catch (parcelsError) {
        console.warn(
          '[map-bundle] Failed to hydrate scoped snapshot parcels:',
          parcelsError instanceof Error ? parcelsError.message : parcelsError
        );
      }
    }
  }

  await maybeAttachCanonicalMetadata(supabase, campaignId, bundle as Record<string, unknown>);

  return json(bundle);
}
