import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

type SessionRow = {
  id: string;
  user_id: string | null;
  campaign_id: string | null;
  start_time: string | null;
  end_time: string | null;
  doors_hit: number | null;
  conversations: number | null;
  flyers_delivered: number | null;
  active_seconds: number | null;
};

type CampaignRow = {
  id: string;
  name: string | null;
  title: string | null;
};

type AppointmentRow = {
  created_at: string | null;
};

function isMissingRelation(error: unknown, relation: string): boolean {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') {
    return false;
  }

  return error.message.toLowerCase().includes(`relation "${relation}" does not exist`);
}

function getPeriodRange(period: 'weekly' | 'monthly' | 'yearly') {
  const end = new Date();
  const start = new Date(end);

  if (period === 'monthly') {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === 'yearly') {
    start.setUTCMonth(0, 1);
    start.setUTCHours(0, 0, 0, 0);
  } else {
    const day = start.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setUTCDate(start.getUTCDate() + diff);
    start.setUTCHours(0, 0, 0, 0);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

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

    const userId = searchParams.get('userId') ?? user.id;
    const period = (searchParams.get('period') ?? 'weekly') as 'weekly' | 'monthly' | 'yearly';
    if (!['weekly', 'monthly', 'yearly'].includes(period)) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
    }

    const { start, end } = getPeriodRange(period);

    const [sessionsRes, appointmentsRes] = await Promise.all([
      supabase
        .from('sessions')
        .select('id, user_id, campaign_id, start_time, end_time, doors_hit, conversations, flyers_delivered, active_seconds')
        .eq('workspace_id', resolution.workspaceId)
        .eq('user_id', userId)
        .gte('start_time', start)
        .lte('start_time', end)
        .order('start_time', { ascending: false }),
      supabase
        .from('crm_events')
        .select('created_at')
        .eq('user_id', userId)
        .not('fub_appointment_id', 'is', null)
        .gte('created_at', start)
        .lte('created_at', end),
    ]);

    if (sessionsRes.error) {
      console.error('[team/report] sessions error:', sessionsRes.error);
      return NextResponse.json({ error: sessionsRes.error.message }, { status: 500 });
    }

    if (appointmentsRes.error && !isMissingRelation(appointmentsRes.error, 'crm_events')) {
      console.error('[team/report] crm_events error:', appointmentsRes.error);
      return NextResponse.json({ error: appointmentsRes.error.message }, { status: 500 });
    }

    const sessions = (sessionsRes.data ?? []) as SessionRow[];
    const appointmentRows = appointmentsRes.error ? [] : ((appointmentsRes.data ?? []) as AppointmentRow[]);

    const campaignIds = Array.from(
      new Set(
        sessions
          .map((session) => session.campaign_id)
          .filter((campaignId): campaignId is string => typeof campaignId === 'string' && campaignId.length > 0)
      )
    );

    let campaignNameById = new Map<string, string>();
    if (campaignIds.length > 0) {
      const { data: campaignRows, error: campaignsError } = await supabase
        .from('campaigns')
        .select('id, name, title')
        .in('id', campaignIds);

      if (campaignsError) {
        console.error('[team/report] campaigns error:', campaignsError);
        return NextResponse.json({ error: campaignsError.message }, { status: 500 });
      }

      campaignNameById = new Map(
        ((campaignRows ?? []) as CampaignRow[]).map((campaign) => [
          campaign.id,
          campaign.title || campaign.name || 'Unnamed territory',
        ])
      );
    }

    const appointmentsCount = appointmentRows.length;
    const totals = sessions.reduce(
      (acc, session) => {
        acc.knocks += Number(session.doors_hit ?? 0) || 0;
        acc.conversations += Number(session.conversations ?? 0) || 0;
        acc.flyers_delivered += Number(session.flyers_delivered ?? 0) || 0;
        acc.sessions_count += 1;
        acc.total_duration_seconds += Number(session.active_seconds ?? 0) || 0;

        const bucketKey =
          period === 'yearly'
            ? (session.start_time ? session.start_time.slice(0, 7) + '-01' : null)
            : (session.start_time ? session.start_time.slice(0, 10) : null);

        if (bucketKey) {
          const current = acc.buckets.get(bucketKey) ?? {
            doors: 0,
            conversations: 0,
            flyers_delivered: 0,
            sessions_count: 0,
          };
          acc.buckets.set(bucketKey, {
            doors: current.doors + (Number(session.doors_hit ?? 0) || 0),
            conversations: current.conversations + (Number(session.conversations ?? 0) || 0),
            flyers_delivered: current.flyers_delivered + (Number(session.flyers_delivered ?? 0) || 0),
            sessions_count: current.sessions_count + 1,
          });
        }

        const territoryKey = session.campaign_id ?? 'unknown';
        const territory = acc.topZones.get(territoryKey) ?? {
          campaign_id: session.campaign_id,
          campaign_name: session.campaign_id ? campaignNameById.get(session.campaign_id) ?? 'Unnamed territory' : 'Unassigned sessions',
          doors: 0,
          conversations: 0,
          flyers_delivered: 0,
          sessions_count: 0,
        };
        acc.topZones.set(territoryKey, {
          ...territory,
          doors: territory.doors + (Number(session.doors_hit ?? 0) || 0),
          conversations: territory.conversations + (Number(session.conversations ?? 0) || 0),
          flyers_delivered: territory.flyers_delivered + (Number(session.flyers_delivered ?? 0) || 0),
          sessions_count: territory.sessions_count + 1,
        });

        return acc;
      },
      {
        knocks: 0,
        conversations: 0,
        flyers_delivered: 0,
        sessions_count: 0,
        total_duration_seconds: 0,
        buckets: new Map<string, { doors: number; conversations: number; flyers_delivered: number; sessions_count: number }>(),
        topZones: new Map<
          string,
          {
            campaign_id: string | null;
            campaign_name: string;
            doors: number;
            conversations: number;
            flyers_delivered: number;
            sessions_count: number;
          }
        >(),
      }
    );

    const activeDays = new Set(
      sessions
        .map((session) => (session.start_time ? session.start_time.slice(0, 10) : null))
        .filter((value): value is string => typeof value === 'string')
    ).size;

    const buckets = Array.from(totals.buckets.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bucketStart, value]) => ({
        bucket_start: bucketStart,
        doors: value.doors,
        conversations: value.conversations,
        flyers_delivered: value.flyers_delivered,
        sessions_count: value.sessions_count,
      }));

    const sessionHistory = sessions.slice(0, 12).map((session) => ({
      id: session.id,
      start_time: session.start_time,
      end_time: session.end_time,
      doors_hit: Number(session.doors_hit ?? 0) || 0,
      conversations: Number(session.conversations ?? 0) || 0,
      flyers_delivered: Number(session.flyers_delivered ?? 0) || 0,
      active_seconds: Number(session.active_seconds ?? 0) || 0,
      campaign_id: session.campaign_id,
      campaign_name: session.campaign_id ? campaignNameById.get(session.campaign_id) ?? 'Unnamed territory' : 'Unassigned sessions',
    }));

    const topZones = Array.from(totals.topZones.values())
      .map((zone) => ({
        ...zone,
        conversation_rate: zone.doors > 0 ? zone.conversations / zone.doors : 0,
      }))
      .sort((left, right) => {
        if (right.conversations !== left.conversations) {
          return right.conversations - left.conversations;
        }
        if (right.doors !== left.doors) {
          return right.doors - left.doors;
        }
        return left.campaign_name.localeCompare(right.campaign_name);
      })
      .slice(0, 5);

    return NextResponse.json({
      totals: {
        knocks: totals.knocks,
        conversations: totals.conversations,
        flyers_delivered: totals.flyers_delivered,
        appointments: appointmentsCount,
        sessions_count: totals.sessions_count,
        active_days: activeDays,
        avg_knocks_per_session: totals.sessions_count > 0 ? Number((totals.knocks / totals.sessions_count).toFixed(1)) : 0,
        total_duration_seconds: totals.total_duration_seconds,
        conversations_per_door: totals.knocks > 0 ? totals.conversations / totals.knocks : 0,
        appointments_per_conversation: totals.conversations > 0 ? appointmentsCount / totals.conversations : 0,
      },
      buckets,
      sessions: sessionHistory,
      topZones,
      period_start: start,
      period_end: end,
    });
  } catch (err) {
    console.error('[team/report] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
