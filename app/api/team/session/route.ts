import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';

/**
 * POST /api/team/session
 * Record a completed session (and activity event). Caller must be workspace member.
 * Body: { workspaceId?, started_at, ended_at?, campaign_id?, stats?: { doors_knocked, conversations, followups, appointments } }
 */
export async function POST(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      workspaceId,
      started_at,
      ended_at,
      campaign_id,
      stats,
    } = body as {
      workspaceId?: string;
      started_at?: string;
      ended_at?: string;
      campaign_id?: string;
      stats?: Record<string, unknown>;
    };

    if (!started_at || typeof started_at !== 'string') {
      return NextResponse.json({ error: 'started_at is required' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const resolution = await resolveWorkspaceIdForUser(supabase as any, user.id, workspaceId ?? undefined);
    if (!resolution.workspaceId) {
      return NextResponse.json(
        { error: resolution.error ?? 'Workspace not found' },
        { status: resolution.status ?? 403 }
      );
    }

    const parsedStats = (stats ?? {}) as Record<string, unknown>;
    const doorsHit = Number(parsedStats.doors_hit ?? parsedStats.doors_knocked ?? 0) || 0;
    const conversations = Number(parsedStats.conversations ?? 0) || 0;
    const flyersDelivered = Number(parsedStats.flyers_delivered ?? parsedStats.followups ?? 0) || 0;
    const activeSeconds =
      Number(parsedStats.active_seconds ?? parsedStats.duration_seconds ?? 0) ||
      Math.max(
        0,
        ended_at ? Math.floor((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000) : 0
      );
    const distanceMeters = Number(parsedStats.distance_meters ?? parsedStats.distance ?? 0) || 0;
    const pathGeoJson =
      typeof parsedStats.path_geojson === 'string'
        ? parsedStats.path_geojson
        : typeof parsedStats.route_geojson === 'string'
          ? parsedStats.route_geojson
          : null;

    const { data: insertedSession, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        workspace_id: resolution.workspaceId,
        user_id: user.id,
        campaign_id: campaign_id ?? null,
        start_time: started_at,
        end_time: ended_at ?? null,
        active_seconds: activeSeconds,
        distance_meters: distanceMeters,
        doors_hit: doorsHit,
        conversations,
        flyers_delivered: flyersDelivered,
        path_geojson: pathGeoJson,
      })
      .select('id')
      .single();
    if (sessionError) {
      console.error('[team/session] insert session:', sessionError);
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }

    const eventPayload = {
      workspace_id: resolution.workspaceId,
      user_id: user.id,
      session_id: insertedSession?.id ?? null,
      event_type: 'session_completed',
      event_time: ended_at ?? new Date().toISOString(),
      payload: {
        started_at,
        ended_at: ended_at ?? null,
        doors_hit: doorsHit,
        conversations,
        flyers_delivered: flyersDelivered,
        active_seconds: activeSeconds,
        distance_meters: distanceMeters,
      },
    };
    let { error: eventError } = await supabase.from('session_events').insert(eventPayload);
    if (eventError) {
      // Some deployments may not include session_id on session_events yet.
      const { session_id: _unused, ...fallbackEventPayload } = eventPayload;
      const retry = await supabase.from('session_events').insert(fallbackEventPayload);
      eventError = retry.error;
    }
    if (eventError) {
      console.error('[team/session] insert session_events:', eventError);
      // Session already inserted; don't fail the request
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[team/session] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
