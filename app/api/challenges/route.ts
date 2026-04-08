import { NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import {
  mapTemplateRow,
  viewerSummaryLine,
  buildRollingViewerInstance,
  mapRpcLeaderboard,
  type ChallengeTemplateRow,
} from '@/app/api/challenges/_lib';

export async function GET() {
  try {
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
    const workspaceId = access.workspaceId;

    const { data: globalRows, error: globalError } = await admin
      .from('challenge_templates')
      .select('*')
      .eq('scope', 'global')
      .neq('status', 'archived')
      .order('created_at', { ascending: true });

    if (globalError) {
      if (globalError.message?.includes('challenge_templates')) {
        return NextResponse.json({ global: [], team: [], warning: 'Challenges schema not migrated yet.' });
      }
      console.error('[challenges] global list', globalError);
      return NextResponse.json({ error: globalError.message }, { status: 500 });
    }

    let teamRows: ChallengeTemplateRow[] = [];
    if (workspaceId) {
      const { data: tr, error: teamError } = await admin
        .from('challenge_templates')
        .select('*')
        .eq('scope', 'team')
        .eq('workspace_id', workspaceId)
        .neq('status', 'archived')
        .order('created_at', { ascending: false });
      if (!teamError && tr) {
        teamRows = tr as ChallengeTemplateRow[];
      }
    }

    const joinAtIso = user.created_at;

    const global = await Promise.all(
      ((globalRows ?? []) as ChallengeTemplateRow[]).map(async (row) => {
        let participantCount = 0;
        if (row.type === 'rolling_onboarding' && row.scope === 'global' && row.status === 'active') {
          const { data: c } = await admin.rpc('count_challenge_rolling_participants', {
            p_challenge_slug: row.slug,
          });
          participantCount = typeof c === 'number' ? c : Number(c) || 0;
        } else {
          participantCount = 0;
        }

        const template = mapTemplateRow(row, participantCount);

        let viewerSummary: string | null = null;
        let viewerInstance: ReturnType<typeof buildRollingViewerInstance> | null = null;
        if (
          row.type === 'rolling_onboarding' &&
          row.scope === 'global' &&
          row.duration_days &&
          typeof joinAtIso === 'string' &&
          joinAtIso.length > 0
        ) {
          const { data: lb } = await admin.rpc('get_challenge_rolling_leaderboard', {
            p_challenge_slug: row.slug,
            p_window: 'challenge_window',
            p_limit: 500,
          });
          const entries = mapRpcLeaderboard(lb as never);
          const mine = entries.find((e) => e.userId === user.id);
          const inst = buildRollingViewerInstance({
            userId: user.id,
            joinAtIso,
            durationDays: row.duration_days,
            challengeWindowScore: mine?.score ?? 0,
            challengeWindowRank: mine?.rank ?? null,
          });
          inst.templateId = row.id;
          viewerInstance = inst;
          viewerSummary = viewerSummaryLine(template, inst);
        }

        return { ...template, viewerSummaryLine: viewerSummary, viewerInstance };
      })
    );

    const team = teamRows.map((row) => ({
      ...mapTemplateRow(row, 0),
      viewerSummaryLine: null as string | null,
    }));

    return NextResponse.json({ global, team });
  } catch (e) {
    console.error('[challenges] GET', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
