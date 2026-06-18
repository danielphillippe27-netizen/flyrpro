import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  isMissingSalespeopleSchemaError,
  normalizeSalespersonReferralCodeInput,
  resolveActiveSalespersonReferralCode,
} from '@/app/lib/billing/salespeople';
import { hashRequestIp } from '@/app/lib/ambassador/tracking';
import { sanitizeTrackingParam } from '@/app/lib/ambassador/portal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DemoEventType =
  | 'page_view'
  | 'video_started'
  | 'play_with_sound'
  | 'progress_25'
  | 'progress_50'
  | 'progress_75'
  | 'video_complete'
  | 'cta_shown'
  | 'start_trial_click'
  | 'founder_call_click'
  | 'page_exit';

const EVENT_TYPES = new Set<DemoEventType>([
  'page_view',
  'video_started',
  'play_with_sound',
  'progress_25',
  'progress_50',
  'progress_75',
  'video_complete',
  'cta_shown',
  'start_trial_click',
  'founder_call_click',
  'page_exit',
]);

function normalizeEventType(value: unknown): DemoEventType | null {
  return typeof value === 'string' && EVENT_TYPES.has(value as DemoEventType)
    ? (value as DemoEventType)
    : null;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeSeconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(24 * 60 * 60, Math.round(parsed));
}

function normalizeMetadata(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 20);
  const metadata: Record<string, string | number | boolean | null> = {};

  for (const [key, rawValue] of entries) {
    const cleanKey = key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    if (!cleanKey) continue;
    if (typeof rawValue === 'string') metadata[cleanKey] = rawValue.slice(0, 300);
    else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) metadata[cleanKey] = rawValue;
    else if (typeof rawValue === 'boolean' || rawValue === null) metadata[cleanKey] = rawValue;
  }

  return metadata;
}

function isMissingDemoEventsSchemaError(message: string | undefined): boolean {
  const normalized = message?.toLowerCase() ?? '';
  return (
    isMissingSalespeopleSchemaError(message) ||
    normalized.includes('salesperson_demo_video_events') ||
    (normalized.includes('relation') && normalized.includes('does not exist')) ||
    (normalized.includes('schema cache') && normalized.includes('salesperson_demo_video_events'))
  );
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const eventType = normalizeEventType(payload?.eventType);
  const referralCode = normalizeSalespersonReferralCodeInput(
    typeof payload?.referralCode === 'string' ? payload.referralCode : ''
  );
  const sessionId = normalizeText(payload?.sessionId, 120);

  if (!eventType || !referralCode || !sessionId) {
    return NextResponse.json({ recorded: false }, { status: 202 });
  }

  const admin = createAdminClient();

  try {
    const salesperson = await resolveActiveSalespersonReferralCode(admin, referralCode);
    if (!salesperson?.id || !salesperson.referral_code) {
      return NextResponse.json({ recorded: false }, { status: 202 });
    }

    const watchSeconds = normalizeSeconds(payload?.watchSeconds);
    const maxWatchSeconds = Math.max(watchSeconds, normalizeSeconds(payload?.maxWatchSeconds));
    const durationSeconds = normalizeSeconds(payload?.videoDurationSeconds);
    const source = sanitizeTrackingParam(
      typeof payload?.source === 'string'
        ? payload.source
        : request.nextUrl.searchParams.get('source')
    );
    const campaign = sanitizeTrackingParam(
      typeof payload?.campaign === 'string'
        ? payload.campaign
        : request.nextUrl.searchParams.get('campaign')
    );

    const { error } = await admin.from('salesperson_demo_video_events').insert({
      salesperson_id: salesperson.id,
      referral_code: salesperson.referral_code.trim().toUpperCase(),
      session_id: sessionId,
      event_type: eventType,
      source,
      campaign,
      watch_seconds: watchSeconds,
      max_watch_seconds: maxWatchSeconds,
      video_duration_seconds: durationSeconds || null,
      metadata: normalizeMetadata(payload?.metadata),
      ip_hash: hashRequestIp(request),
      user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      referer: request.headers.get('referer')?.slice(0, 500) ?? null,
    });

    if (error) {
      if (isMissingDemoEventsSchemaError(error.message)) {
        return NextResponse.json({ recorded: false, storageReady: false }, { status: 202 });
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ recorded: true });
  } catch (error) {
    console.error('[salesperson demo events] failed', error);
    return NextResponse.json({ recorded: false }, { status: 202 });
  }
}
