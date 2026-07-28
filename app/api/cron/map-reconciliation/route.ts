import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { CampaignMapReconciliationService } from '@/lib/services/CampaignMapReconciliationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workerId = `vercel-cron:${randomUUID()}`;
  const service = new CampaignMapReconciliationService(createAdminClient());
  try {
    const run = await service.claimAndProcess(workerId);
    return NextResponse.json({
      ok: true,
      claimed: Boolean(run),
      run_id: run?.id ?? null,
      campaign_id: run?.campaign_id ?? null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

