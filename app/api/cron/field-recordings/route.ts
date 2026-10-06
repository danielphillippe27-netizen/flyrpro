import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { dispatchFieldRecordings } from '@/lib/field-recordings/worker';
import { expireFieldRecordings } from '@/lib/field-recordings/retention-worker';
import { retentionEnabled } from '@/lib/field-recordings/retention';
import { cleanupFieldRecordingStorage } from '@/lib/field-recordings/deletion-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ? Buffer.from(`Bearer ${process.env.CRON_SECRET}`) : null;
  const received = Buffer.from(request.headers.get('authorization') || '');
  if (!expected || received.length !== expected.length || !timingSafeEqual(received, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const retention = retentionEnabled(process.env.FIELD_RECORDING_RETENTION_ENABLED, process.env.FIELD_RECORDING_DELETION_ENABLED) ? await expireFieldRecordings() : { recordingsExpired: 0, retentionPaused: true };
    const cleanup = process.env.FIELD_RECORDING_STORAGE_CLEANUP_ENABLED === 'true' ? await cleanupFieldRecordingStorage() : { storageCleaned: 0, cleanupPaused: true };
    return NextResponse.json({ ...await dispatchFieldRecordings(), ...cleanup, ...retention });
  }
  catch { return NextResponse.json({ error: 'Recording queue unavailable' }, { status: 503 }); }
}
