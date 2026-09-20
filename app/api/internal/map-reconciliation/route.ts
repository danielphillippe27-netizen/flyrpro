import { randomUUID } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { CampaignMapReconciliationService } from '@/lib/services/CampaignMapReconciliationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const runId = body?.runId;
  if (typeof runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    return NextResponse.json({ error: 'Invalid runId' }, { status: 400 });
  }
  after(async () => {
    try {
      await new CampaignMapReconciliationService(createAdminClient())
        .claimQueuedRunAndProcess(runId, `immediate:${randomUUID()}`);
    } catch (error) {
      console.error('[MapReconciliation] Immediate worker failed; cron will recover:', error);
    }
  });
  return NextResponse.json({ accepted: true, run_id: runId }, { status: 202 });
}
