import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode, resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

function isMissingColumn(error: unknown, table: string, column: string): boolean {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes(`column ${table}.${column}`) && message.includes('does not exist');
}

type SessionDetailRow = {
  id: string;
  user_id: string | null;
  campaign_id: string | null;
  start_time: string | null;
  end_time: string | null;
  active_seconds: number | null;
  distance_meters: number | null;
  doors_hit: number | null;
  conversations: number | null;
  flyers_delivered: number | null;
  leads_created?: number | null;
  path_geojson?: string | null;
};

type CampaignNameRow = {
  id: string;
  name: string | null;
  title: string | null;
};

type UserProfileNameRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

function displayNameFromProfile(profile: UserProfileNameRow | null | undefined): string {
  const displayName = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  return displayName || 'Member';
}

/**
 * GET /api/team/session?workspaceId=&sessionId=
 * Return one session with analytics and GPS breadcrumb. Team leaders only.
 */
export async function GET(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId') ?? undefined;
    const sessionId = searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const resolution = await resolveTeamDashboardMode(
      supabase as unknown as MinimalSupabaseClient,
      user.id,
      workspaceId
    );
    if (resolution.error || !resolution.workspaceId || resolution.mode !== 'team_owner') {
      return NextResponse.json(
        { error: resolution.error ?? 'Forbidden' },
        { status: resolution.status ?? 403 }
      );
    }

    let includeLeadsCreated = true;
    let includePathGeojson = true;
    let session: SessionDetailRow | null = null;

    while (true) {
      const selectColumns = [
        'id',
        'user_id',
        'campaign_id',
        'start_time',
        'end_time',
        'active_seconds',
        'distance_meters',
        'doors_hit',
        'conversations',
        'flyers_delivered',
      ];
      if (includeLeadsCreated) selectColumns.push('leads_created');
      if (includePathGeojson) selectColumns.push('path_geojson');

      const { data, error } = await supabase
        .from('sessions')
        .select(selectColumns.join(', '))
        .eq('workspace_id', resolution.workspaceId)
        .eq('id', sessionId)
        .maybeSingle();

      if (!error) {
        session = (data ?? null) as SessionDetailRow | null;
        break;
      }
      if (includeLeadsCreated && isMissingColumn(error, 'sessions', 'leads_created')) {
        includeLeadsCreated = false;
        continue;
      }
      if (includePathGeojson && isMissingColumn(error, 'sessions', 'path_geojson')) {
        includePathGeojson = false;
        continue;
      }

      console.error('[team/session] fetch session:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const [campaignResult, profileResult] = await Promise.all([
      session.campaign_id
        ? supabase
            .from('campaigns')
            .select('id, name, title')
            .eq('id', session.campaign_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      session.user_id
        ? supabase
            .from('user_profiles')
            .select('user_id, first_name, last_name')
            .eq('user_id', session.user_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const campaign = campaignResult.data as CampaignNameRow | null;
    const profile = profileResult.data as UserProfileNameRow | null;
    const doorsHit = Number(session.doors_hit ?? 0) || 0;
    const conversations = Number(session.conversations ?? 0) || 0;
    const leadsCreated = Number(session.leads_created ?? 0) || 0;

    return NextResponse.json({
      session: {
        id: session.id,
        user_id: session.user_id,
        display_name: displayNameFromProfile(profile),
        campaign_id: session.campaign_id,
        campaign_name: campaign?.title || campaign?.name || 'Unassigned session',
        start_time: session.start_time,
        end_time: session.end_time,
        active_seconds: Number(session.active_seconds ?? 0) || 0,
        distance_meters: Number(session.distance_meters ?? 0) || 0,
        doors_hit: doorsHit,
        conversations,
        flyers_delivered: Number(session.flyers_delivered ?? 0) || 0,
        leads_created: leadsCreated,
        conversations_per_door: doorsHit > 0 ? conversations / doorsHit : 0,
        leads_per_conversation: conversations > 0 ? leadsCreated / conversations : 0,
        path_geojson: session.path_geojson ?? null,
      },
    });
  } catch (err) {
    console.error('[team/session] fetch error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/team/session
 * Record a completed session (and activity event). Caller must be workspace member.
 * Body: { workspaceId?, started_at, ended_at?, campaign_id?, stats?: { doors_knocked, conversations, leads_created, followups, appointments } }
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
    const resolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      user.id,
      workspaceId ?? undefined
    );
    if (!resolution.workspaceId) {
      return NextResponse.json(
        { error: resolution.error ?? 'Workspace not found' },
        { status: resolution.status ?? 403 }
      );
    }

    const parsedStats = (stats ?? {}) as Record<string, unknown>;
    const doorsHit = Number(parsedStats.doors_hit ?? parsedStats.doors_knocked ?? 0) || 0;
    const conversations = Number(parsedStats.conversations ?? 0) || 0;
    const leadsCreated = Number(parsedStats.leads_created ?? parsedStats.leads ?? 0) || 0;
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

    const sessionInsert = {
      workspace_id: resolution.workspaceId,
      user_id: user.id,
      campaign_id: campaign_id ?? null,
      start_time: started_at,
      end_time: ended_at ?? null,
      active_seconds: activeSeconds,
      distance_meters: distanceMeters,
      doors_hit: doorsHit,
      conversations,
      leads_created: leadsCreated,
      flyers_delivered: flyersDelivered,
      path_geojson: pathGeoJson,
    };

    let { data: insertedSession, error: sessionError } = await supabase
      .from('sessions')
      .insert(sessionInsert)
      .select('id')
      .single();

    if (sessionError && isMissingColumn(sessionError, 'sessions', 'leads_created')) {
      const fallbackInsert: Partial<typeof sessionInsert> = { ...sessionInsert };
      delete fallbackInsert.leads_created;
      const fallbackResult = await supabase
        .from('sessions')
        .insert(fallbackInsert)
        .select('id')
        .single();
      insertedSession = fallbackResult.data;
      sessionError = fallbackResult.error;
    }
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
        leads_created: leadsCreated,
        flyers_delivered: flyersDelivered,
        active_seconds: activeSeconds,
        distance_meters: distanceMeters,
      },
    };
    let { error: eventError } = await supabase.from('session_events').insert(eventPayload);
    if (eventError) {
      // Some deployments may not include session_id on session_events yet.
      const fallbackEventPayload: Partial<typeof eventPayload> = { ...eventPayload };
      delete fallbackEventPayload.session_id;
      const retry = await supabase.from('session_events').insert(fallbackEventPayload);
      eventError = retry.error;
    }
    if (eventError) {
      console.error('[team/session] insert session_events:', eventError);
      // Session already inserted; don't fail the request
    }

    const sessionId = insertedSession?.id ?? null;

    try {
      await supabase.functions.invoke('evaluate-badges', {
        body: {
          user_id: user.id,
          session_id: sessionId,
        },
      });
    } catch (badgeError) {
      console.warn('[team/session] evaluate-badges failed:', badgeError);
    }

    if (sessionId) {
      try {
        const shareCardUrl = new URL('/api/share-card', request.nextUrl.origin);
        shareCardUrl.searchParams.set('user_id', user.id);
        shareCardUrl.searchParams.set('session_id', sessionId);
        await fetch(shareCardUrl, {
          method: 'POST',
          cache: 'no-store',
        });
      } catch (shareCardError) {
        console.warn('[team/session] share-card warm failed:', shareCardError);
      }
    }

    return NextResponse.json({ ok: true, session_id: sessionId });
  } catch (err) {
    console.error('[team/session] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
