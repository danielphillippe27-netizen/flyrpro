import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

type SegmentInput = {
  street_name?: unknown;
  side?: unknown;
  from_house?: unknown;
  to_house?: unknown;
  stop_count?: unknown;
  color?: unknown;
  line_geojson?: unknown;
  notes?: unknown;
};

type StopInput = {
  stop_order?: unknown;
  address_id?: unknown;
  gers_id?: unknown;
  lat?: unknown;
  lng?: unknown;
  display_address?: unknown;
  building_id?: unknown;
};

function asUuid(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeSide(value: unknown): 'odds' | 'evens' | 'both' {
  const side = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (side === 'odds' || side === 'odd') return 'odds';
  if (side === 'evens' || side === 'even') return 'evens';
  return 'both';
}

function toLineGeoJson(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'LineString') return null;
  if (!Array.isArray(candidate.coordinates)) return null;
  return {
    type: 'LineString',
    coordinates: candidate.coordinates,
  };
}

export async function POST(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      workspaceId?: unknown;
      campaignId?: unknown;
      name?: unknown;
      status?: unknown;
      estMinutes?: unknown;
      distanceMeters?: unknown;
      segments?: SegmentInput[];
      stops?: StopInput[];
    } | null;

    const workspaceId = asUuid(body?.workspaceId);
    const campaignId = asUuid(body?.campaignId);
    const routeName = asString(body?.name);
    const status = asString(body?.status)?.toLowerCase() ?? 'active';
    const estMinutes = asInt(body?.estMinutes);
    const distanceMeters = asInt(body?.distanceMeters);
    const segments = Array.isArray(body?.segments) ? body?.segments : [];
    const stops = Array.isArray(body?.stops) ? body?.stops : [];

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }
    if (!routeName) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (segments.length === 0) {
      return NextResponse.json({ error: 'segments are required' }, { status: 400 });
    }
    if (!['draft', 'active', 'archived'].includes(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: membership } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json({ error: 'Only workspace owners/admins can create route plans.' }, { status: 403 });
    }

    if (campaignId) {
      const { data: campaign } = await admin
        .from('campaigns')
        .select('id, workspace_id')
        .eq('id', campaignId)
        .maybeSingle();
      if (!campaign?.id || campaign.workspace_id !== workspaceId) {
        return NextResponse.json(
          { error: 'campaignId does not belong to workspaceId' },
          { status: 400 }
        );
      }
    }

    const normalizedSegments = segments.map((segment, index) => {
      const streetName = asString(segment.street_name) ?? `Segment ${index + 1}`;
      const stopCount = Math.max(0, asInt(segment.stop_count) ?? 0);
      return {
        order: index + 1,
        street_name: streetName,
        side: normalizeSide(segment.side),
        from_house: asString(segment.from_house) ?? asInt(segment.from_house),
        to_house: asString(segment.to_house) ?? asInt(segment.to_house),
        stop_count: stopCount,
        color: asString(segment.color),
        line_geojson: toLineGeoJson(segment.line_geojson),
        notes: asString(segment.notes),
      };
    });

    const totalStops = stops.length > 0
      ? stops.length
      : normalizedSegments.reduce((sum, segment) => sum + (segment.stop_count ?? 0), 0);

    const { data: planRow, error: planError } = await admin
      .from('route_plans')
      .insert({
        workspace_id: workspaceId,
        campaign_id: campaignId,
        created_by_user_id: user.id,
        name: routeName,
        status,
        total_stops: totalStops,
        est_minutes: estMinutes,
        distance_meters: distanceMeters,
        segments: normalizedSegments,
      })
      .select('id, workspace_id, campaign_id, name, status, total_stops, est_minutes, distance_meters, created_at')
      .single();

    if (planError || !planRow) {
      return NextResponse.json(
        { error: planError?.message ?? 'Failed to create route plan' },
        { status: 500 }
      );
    }

    if (stops.length > 0) {
      const normalizedStops = stops.map((stop, index) => ({
        route_plan_id: planRow.id,
        stop_order: Math.max(1, asInt(stop.stop_order) ?? index + 1),
        address_id: asUuid(stop.address_id),
        gers_id: asString(stop.gers_id),
        lat: asNumber(stop.lat),
        lng: asNumber(stop.lng),
        display_address: asString(stop.display_address),
        building_id: asUuid(stop.building_id),
      }));

      const { error: stopsError } = await admin.from('route_stops').insert(normalizedStops);
      if (stopsError) {
        await admin.from('route_plans').delete().eq('id', planRow.id);
        return NextResponse.json(
          { error: stopsError.message ?? 'Failed to create route stops' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      routePlan: planRow,
      stopsInserted: stops.length,
    });
  } catch (error) {
    console.error('[api/routes/create_from_segments] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
