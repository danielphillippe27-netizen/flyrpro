import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { collectAustralianHail } from '@/lib/storm-maps/intelligence/australian-hail-collector';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: 'Australian storm scheduler is not configured.' }, { status: 503 });
  const actual = Buffer.from(request.headers.get('authorization') ?? ''), expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { const result = await collectAustralianHail(); return NextResponse.json(result, { status: result.status === 'partial' ? 503 : 200 }); }
  catch { return NextResponse.json({ error: 'Australian collection failed; missing data is not zero storms.' }, { status: 503 }); }
}
