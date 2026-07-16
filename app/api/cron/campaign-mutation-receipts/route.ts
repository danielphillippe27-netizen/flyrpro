import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  let deleted = 0;
  let batches = 0;

  // Keep each invocation bounded. A later daily run continues from the oldest row.
  while (batches < 10) {
    const { data, error } = await admin.rpc(
      'cleanup_expired_campaign_mutation_receipts',
      { p_limit: 10_000 }
    );
    if (error) {
      return NextResponse.json({ error: error.message, deleted, batches }, { status: 500 });
    }

    const count = Number(data ?? 0);
    deleted += Number.isFinite(count) ? count : 0;
    batches += 1;
    if (count < 10_000) break;
  }

  return NextResponse.json({ ok: true, deleted, batches });
}
