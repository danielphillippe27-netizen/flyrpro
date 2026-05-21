import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import {
  fetchScopedPmtilesBuildingFeatures,
  type ScopedBuildingFeatureCollection,
} from '@/app/api/campaigns/_utils/scoped-pmtiles-buildings';
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

  return json(bundle);
}
