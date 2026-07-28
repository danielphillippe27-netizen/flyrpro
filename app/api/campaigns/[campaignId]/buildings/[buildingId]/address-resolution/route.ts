import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import {
  normalizeBuildingRouteId,
  resolveCampaignBuilding,
} from '@/app/api/campaigns/_utils/resolve-campaign-building';
import { createAdminClient } from '@/lib/supabase/server';
import {
  prebuildCampaignMapBundle,
  readCurrentCampaignMapBundle,
} from '@/lib/services/CampaignMapBundlePrebuilder';
import { CampaignMapReconciliationService } from '@/lib/services/CampaignMapReconciliationService';
import { StableLinkerService } from '@/lib/services/StableLinkerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ campaignId: string; buildingId: string | string[] }>;
};

type JsonRecord = Record<string, unknown>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePoint(value: unknown): [number, number] | undefined {
  if (!value) return undefined;
  if (typeof value === 'object') {
    const candidate = value as { type?: unknown; coordinates?: unknown };
    if (candidate.type === 'Point' && Array.isArray(candidate.coordinates)) {
      const longitude = numberValue(candidate.coordinates[0]);
      const latitude = numberValue(candidate.coordinates[1]);
      return longitude === null || latitude === null ? undefined : [longitude, latitude];
    }
  }
  if (typeof value === 'string') {
    try {
      return parsePoint(JSON.parse(value));
    } catch {
      const match = value.match(/POINT\s*\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/i);
      if (match) return [Number(match[1]), Number(match[2])];
    }
  }
  return undefined;
}

async function replayResponse(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string,
  idempotencyKey: string
): Promise<NextResponse | null> {
  const { data } = await admin
    .from('map_reconciliation_idempotency')
    .select('response')
    .eq('campaign_id', campaignId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  return data?.response
    ? NextResponse.json({ ...(data.response as JsonRecord), replayed: true })
    : null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { campaignId, buildingId: routeBuildingId } = await context.params;
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  if (!await ensureCampaignAccess(admin, campaignId, user.id)) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }
  const body = await request.json().catch(() => null) as JsonRecord | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const idempotencyKey = stringValue(
    request.headers.get('idempotency-key') ??
    request.headers.get('x-idempotency-key') ??
    body.idempotency_key
  );
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'Idempotency-Key is required' }, { status: 400 });
  }
  const replay = await replayResponse(admin, campaignId, idempotencyKey);
  if (replay) return replay;

  const currentBundle = await readCurrentCampaignMapBundle(admin, campaignId);
  const baseSignature = stringValue(body.base_bundle_signature);
  let acceptedHistoricalOfflineBase = false;
  if (
    baseSignature &&
    currentBundle?.asset_signature !== baseSignature &&
    body.offline_mutation === true
  ) {
    const { data: historicalBundle } = await admin
      .from('campaign_map_bundles')
      .select('asset_signature')
      .eq('campaign_id', campaignId)
      .eq('asset_signature', baseSignature)
      .limit(1)
      .maybeSingle();
    acceptedHistoricalOfflineBase =
      Boolean(historicalBundle?.asset_signature) ||
      /^[a-f0-9]{64}$/i.test(baseSignature);
  }
  if (!baseSignature || (
    currentBundle?.asset_signature !== baseSignature &&
    !acceptedHistoricalOfflineBase
  )) {
    return NextResponse.json({
      error: 'BASE_BUNDLE_CONFLICT',
      current_bundle_signature: currentBundle?.asset_signature ?? null,
    }, { status: 409 });
  }

  const buildingId = normalizeBuildingRouteId(routeBuildingId);
  const building = await resolveCampaignBuilding(admin, campaignId, buildingId);
  if (!building) return NextResponse.json({ error: 'Building not found' }, { status: 404 });

  const action = stringValue(body.action);
  if (!['confirm_existing', 'create_manual', 'reject_suggestion', 'undo'].includes(action ?? '')) {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  }

  try {
    const linker = new StableLinkerService(admin);
    let response: JsonRecord;

    if (action === 'reject_suggestion') {
      const decisionId = stringValue(body.decision_id);
      if (!decisionId) return NextResponse.json({ error: 'decision_id is required' }, { status: 400 });
      const { data, error } = await admin
        .from('map_reconciliation_decisions')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          review_reason: stringValue(body.reason) ?? 'Rejected from map',
        })
        .eq('id', decisionId)
        .eq('campaign_id', campaignId)
        .in('status', ['proposed', 'requires_review'])
        .select('id')
        .maybeSingle();
      if (error || !data) throw new Error(error?.message ?? 'Suggestion is no longer reviewable');
      response = { action, decision_id: decisionId, status: 'rejected' };
    } else if (action === 'undo' && stringValue(body.decision_id)) {
      response = await new CampaignMapReconciliationService(admin).rollbackDecision(
        stringValue(body.decision_id)!,
        user.id,
        stringValue(body.reason) ?? undefined
      );
    } else {
      let addressId = stringValue(body.address_id);
      if (action === 'create_manual') {
        addressId = addressId ?? randomUUID();
        if (!UUID_PATTERN.test(addressId)) {
          return NextResponse.json({ error: 'address_id must be a UUID' }, { status: 400 });
        }
        const longitude = numberValue(body.longitude);
        const latitude = numberValue(body.latitude);
        const formatted = stringValue(body.formatted);
        if (longitude === null || latitude === null || !formatted) {
          return NextResponse.json({
            error: 'formatted, longitude and latitude are required',
          }, { status: 400 });
        }
        const { data: sequenceRow } = await admin
          .from('campaign_addresses')
          .select('seq')
          .eq('campaign_id', campaignId)
          .order('seq', { ascending: false })
          .limit(1)
          .maybeSingle();
        const { error } = await admin.from('campaign_addresses').upsert({
          id: addressId,
          campaign_id: campaignId,
          formatted,
          house_number: stringValue(body.house_number),
          street_name: stringValue(body.street_name),
          locality: stringValue(body.locality),
          region: stringValue(body.region),
          postal_code: stringValue(body.postal_code),
          source: 'manual',
          source_id: `client:${addressId}`,
          geom: `SRID=4326;POINT(${longitude} ${latitude})`,
          coordinate: { longitude, latitude },
          seq: Math.max(-1, Number(sequenceRow?.seq ?? -1)) + 1,
        }, { onConflict: 'id' });
        if (error) throw new Error(`Failed to create manual address: ${error.message}`);
      }

      if (!addressId) return NextResponse.json({ error: 'address_id is required' }, { status: 400 });
      const { data: address, error: addressError } = await admin
        .from('campaign_addresses')
        .select('id, geom, source, building_id, building_gers_id')
        .eq('campaign_id', campaignId)
        .eq('id', addressId)
        .maybeSingle();
      if (addressError || !address) throw new Error(addressError?.message ?? 'Address not found');

      if (action === 'undo') {
        const result = await linker.unassignAddressFromBuilding({
          campaignId,
          addressId,
          buildingRowId: building.rowId,
          buildingPublicId: building.publicId,
          deleteManualAddress: body.delete_manual_address === true && address.source === 'manual',
        });
        response = { action, address_id: addressId, ...result };
      } else {
        const coordinate = parsePoint(address.geom);
        const result = building.rowId
          ? await linker.assignAddressToBuilding({
              campaignId,
              addressId,
              buildingRowId: building.rowId,
              buildingPublicId: building.publicId,
              coordinate,
              assignedBy: user.id,
            })
          : await linker.assignAddressToGoldBuilding({
              campaignId,
              addressId,
              buildingPublicId: building.publicId,
              coordinate,
              assignedBy: user.id,
            });
        await admin
          .from('building_address_links')
          .update({ user_confirmed: true, locked: true, link_state: 'active' })
          .eq('campaign_id', campaignId)
          .eq('address_id', addressId);
        response = { action, address_id: addressId, building_id: building.publicId, ...result };
      }
      const rebuilt = await prebuildCampaignMapBundle(admin, campaignId, undefined, {
        forceRebuild: true,
      });
      response.bundle_signature = rebuilt.asset_signature;
    }

    const linkedAddressIds = Array.isArray(response.linkedAddressIds)
      ? response.linkedAddressIds
      : Array.isArray(response.linked_address_ids)
        ? response.linked_address_ids
        : undefined;
    const storedResponse = {
      success: true,
      campaign_id: campaignId,
      ...response,
      ...(linkedAddressIds ? { linked_address_ids: linkedAddressIds } : {}),
      ...(typeof response.unitCount === 'number' ? { unit_count: response.unitCount } : {}),
      idempotency_key: idempotencyKey,
    };
    const { error: storeError } = await admin.from('map_reconciliation_idempotency').insert({
      campaign_id: campaignId,
      idempotency_key: idempotencyKey,
      decision_id: stringValue(body.decision_id),
      response: storedResponse,
    });
    if (storeError) {
      const racedReplay = await replayResponse(admin, campaignId, idempotencyKey);
      if (racedReplay) return racedReplay;
      throw new Error(`Failed to record idempotency result: ${storeError.message}`);
    }
    return NextResponse.json(storedResponse);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Address resolution failed',
    }, { status: 409 });
  }
}
