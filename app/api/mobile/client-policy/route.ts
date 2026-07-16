import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ClientPolicyRow = {
  platform: 'ios' | 'android';
  minimum_campaign_mutation_build: number | null;
  candidate_available_at: string | null;
  enforce_after: string | null;
  store_url: string | null;
  warning_message: string | null;
  updated_at: string;
};

export async function GET(request: NextRequest) {
  const platform = request.nextUrl.searchParams.get('platform')?.trim().toLowerCase();
  if (platform !== 'ios' && platform !== 'android') {
    return NextResponse.json(
      { error: 'platform must be ios or android' },
      { status: 400 }
    );
  }

  const suppliedBuild = Number(request.nextUrl.searchParams.get('build'));
  const build = Number.isInteger(suppliedBuild) && suppliedBuild >= 0
    ? suppliedBuild
    : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('mobile_client_policies')
    .select(
      'platform, minimum_campaign_mutation_build, candidate_available_at, enforce_after, store_url, warning_message, updated_at'
    )
    .eq('platform', platform)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const policy = data as ClientPolicyRow | null;
  const minimumBuild = policy?.minimum_campaign_mutation_build ?? null;
  const belowMinimum = minimumBuild !== null && (build === null || build < minimumBuild);
  const enforceAt = policy?.enforce_after ? new Date(policy.enforce_after).getTime() : null;
  const now = Date.now();
  const blocked = belowMinimum && enforceAt !== null && enforceAt <= now;
  const warning = belowMinimum && !blocked && (
    minimumBuild !== null ||
    (policy?.candidate_available_at ? new Date(policy.candidate_available_at).getTime() <= now : false)
  );

  return NextResponse.json(
    {
      platform,
      minimum_build: minimumBuild,
      candidate_available_at: policy?.candidate_available_at ?? null,
      enforcement_time: policy?.enforce_after ?? null,
      store_url: policy?.store_url ?? null,
      message: policy?.warning_message ?? null,
      state: blocked ? 'blocked' : warning ? 'warning' : 'allowed',
      warning,
      blocked,
      checked_at: new Date(now).toISOString(),
    },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } }
  );
}
