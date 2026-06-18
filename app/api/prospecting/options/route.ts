import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { getD2DJobSignalProvider } from '@/lib/scraper/d2dJobSignals';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalespersonWorkspaceRow = {
  workspace_id: string | null;
};

async function resolveWorkspaceId(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; email: string | null },
  requestedWorkspaceId: string | null
): Promise<string | null> {
  const normalizedEmail = user.email?.trim().toLowerCase();

  if (normalizedEmail) {
    const { data, error } = await admin
      .from('salespeople')
      .select('workspace_id')
      .eq('email', normalizedEmail)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!error && (data as SalespersonWorkspaceRow | null)?.workspace_id) {
      return (data as SalespersonWorkspaceRow).workspace_id;
    }
  }

  const resolution = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    user.id,
    requestedWorkspaceId
  );

  return resolution.workspaceId;
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');
  const workspaceId = await resolveWorkspaceId(admin, requestUser, requestedWorkspaceId);

  const [marketsResult, industriesResult, runsResult] = await Promise.all([
    admin
      .from('prospect_markets')
      .select('id, country_code, region, city, label, priority')
      .eq('enabled', true)
      .order('priority', { ascending: true })
      .order('country_code', { ascending: true })
      .order('region', { ascending: true })
      .order('city', { ascending: true }),
    admin
      .from('prospect_industries')
      .select('id, name, slug, default_terms, priority')
      .eq('enabled', true)
      .order('priority', { ascending: true })
      .order('name', { ascending: true }),
    workspaceId
      ? admin
          .from('prospect_search_runs')
          .select('id, market_id, industry_id, city, region, country_code, industry, raw_count, unique_count, saved_count, dialer_count, status, completed_at, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (marketsResult.error) {
    console.error('[prospecting/options] failed to load markets', marketsResult.error);
    return NextResponse.json({ error: 'Failed to load prospecting markets.' }, { status: 500 });
  }

  if (industriesResult.error) {
    console.error('[prospecting/options] failed to load industries', industriesResult.error);
    return NextResponse.json({ error: 'Failed to load prospecting industries.' }, { status: 500 });
  }

  if (runsResult.error) {
    console.error('[prospecting/options] failed to load search runs', runsResult.error);
    return NextResponse.json({ error: 'Failed to load prospecting history.' }, { status: 500 });
  }

  const jobSignalProvider = getD2DJobSignalProvider();

  return NextResponse.json({
    workspaceId,
    markets: marketsResult.data ?? [],
    industries: industriesResult.data ?? [],
    recentRuns: runsResult.data ?? [],
    jobSignals: {
      configured: Boolean(jobSignalProvider),
      provider: jobSignalProvider,
    },
  });
}
