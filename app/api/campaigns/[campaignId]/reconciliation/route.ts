import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function etag(value: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(value)).digest('hex')}"`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  if (!await ensureCampaignAccess(admin, campaignId, user.id)) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const { data, error } = await admin
    .from('map_reconciliation_runs')
    .select('id, mode, status, phase, algorithm_version, queued_at, started_at, completed_at, applied_bundle_signature, report, error_message')
    .eq('campaign_id', campaignId)
    .neq('status', 'superseded')
    .order('queued_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: 'Failed to read reconciliation status' }, { status: 500 });
  }

  const body = !data || data.mode === 'shadow'
    ? { status: 'not_started', report: {} }
    : {
        status: data.status,
        phase: data.phase,
        run_id: data.id,
        algorithm_version: data.algorithm_version,
        queued_at: data.queued_at,
        started_at: data.started_at,
        completed_at: data.completed_at,
        applied_bundle_signature: data.applied_bundle_signature,
        report: data.report ?? {},
        error: data.status === 'failed' ? data.error_message : null,
      };
  const responseEtag = etag(body);
  if (request.headers.get('if-none-match') === responseEtag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: responseEtag, 'Cache-Control': 'private, no-cache' },
    });
  }
  return NextResponse.json(body, {
    headers: { ETag: responseEtag, 'Cache-Control': 'private, no-cache' },
  });
}
