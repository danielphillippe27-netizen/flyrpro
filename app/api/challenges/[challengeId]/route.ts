import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import {
  challengeLookupFilter,
  mapTemplateRow,
  mapRpcLeaderboard,
  buildRollingViewerInstance,
  overviewFromEntries,
  type ChallengeTemplateRow,
} from '@/app/api/challenges/_lib';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ challengeId: string }> }
) {
  try {
    const { challengeId: rawId } = await context.params;
    const auth = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await auth.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const access = await resolveDashboardAccessLevel(
      admin as unknown as MinimalSupabaseClient,
      user.id
    );

    const lookup = challengeLookupFilter(rawId);
    let query = admin.from('challenge_templates').select('*');
    if (lookup.id) {
      query = query.eq('id', lookup.id);
    } else if (lookup.slug) {
      query = query.eq('slug', lookup.slug);
    } else {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: row, error: fetchError } = await query.maybeSingle();
    if (fetchError || !row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const templateRow = row as ChallengeTemplateRow;
    if (templateRow.scope === 'team') {
      if (!access.workspaceId || templateRow.workspace_id !== access.workspaceId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const joinAtIso = user.created_at;

    let participantCount = 0;
    if (
      templateRow.type === 'rolling_onboarding' &&
      templateRow.scope === 'global' &&
      templateRow.status === 'active'
    ) {
      const { data: c } = await admin.rpc('count_challenge_rolling_participants', {
        p_challenge_slug: templateRow.slug,
      });
      participantCount = typeof c === 'number' ? c : Number(c) || 0;
    }

    const template = mapTemplateRow(templateRow, participantCount);

    let leaderboardAllTime: ReturnType<typeof mapRpcLeaderboard> = [];
    let leaderboardLast30Days: ReturnType<typeof mapRpcLeaderboard> = [];
    let viewerInstance: ReturnType<typeof buildRollingViewerInstance> | null = null;

    if (
      templateRow.type === 'rolling_onboarding' &&
      templateRow.scope === 'global' &&
      templateRow.duration_days &&
      typeof joinAtIso === 'string' &&
      joinAtIso.length > 0
    ) {
      const [cw, l30] = await Promise.all([
        admin.rpc('get_challenge_rolling_leaderboard', {
          p_challenge_slug: templateRow.slug,
          p_window: 'challenge_window',
          p_limit: 200,
        }),
        admin.rpc('get_challenge_rolling_leaderboard', {
          p_challenge_slug: templateRow.slug,
          p_window: 'last_30_days',
          p_limit: 200,
        }),
      ]);

      leaderboardAllTime = mapRpcLeaderboard(cw.data as never);
      leaderboardLast30Days = mapRpcLeaderboard(l30.data as never);

      const mine = leaderboardAllTime.find((e) => e.userId === user.id);
      const inst = buildRollingViewerInstance({
        userId: user.id,
        joinAtIso,
        durationDays: templateRow.duration_days,
        challengeWindowScore: mine?.score ?? 0,
        challengeWindowRank: mine?.rank ?? null,
      });
      inst.templateId = templateRow.id;
      viewerInstance = inst;
    }

    const overview = overviewFromEntries(template, leaderboardAllTime, participantCount);

    const leaderboardLocked =
      template.templateStatus === 'completed' ||
      template.templateStatus === 'archived' ||
      viewerInstance?.locked === true;

    return NextResponse.json({
      viewerUserId: user.id,
      template,
      viewerInstance,
      viewerLatestSessionId:
        leaderboardAllTime.find((entry) => entry.userId === user.id)?.latestSessionId ?? null,
      leaderboard: leaderboardAllTime,
      leaderboardLast30Days,
      overview,
      leaderboardLocked,
    });
  } catch (e) {
    console.error('[challenges/detail] GET', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
