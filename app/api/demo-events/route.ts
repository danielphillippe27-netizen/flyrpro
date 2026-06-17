import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RawDemoEvent = {
  event?: unknown;
  beat?: unknown;
  t_ms?: unknown;
  meta?: unknown;
};

type DemoEventsBody = {
  slug?: unknown;
  session_id?: unknown;
  events?: unknown;
};

function cleanEvent(raw: RawDemoEvent, slug: string, sessionId: string) {
  const event = typeof raw.event === 'string' ? raw.event.trim() : '';
  if (!event) {
    return null;
  }

  return {
    slug,
    session_id: sessionId,
    event,
    beat: typeof raw.beat === 'number' && Number.isFinite(raw.beat) ? raw.beat : null,
    t_ms: typeof raw.t_ms === 'number' && Number.isFinite(raw.t_ms) ? Math.round(raw.t_ms) : null,
    meta:
      raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)
        ? (raw.meta as Record<string, unknown>)
        : {},
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as DemoEventsBody | null;
    const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
    const sessionId = typeof body?.session_id === 'string' ? body.session_id.trim() : '';
    const events = Array.isArray(body?.events) ? body.events : [];

    if (!slug || !sessionId || events.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const rows = events
      .map((event) => cleanEvent(event as RawDemoEvent, slug, sessionId))
      .filter((event): event is NonNullable<ReturnType<typeof cleanEvent>> => event !== null);

    if (rows.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const admin = createAdminClient();
    const { error } = await admin.from('demo_events').insert(rows);

    if (error) {
      console.error('[demo-events] Insert failed:', error);
    }
  } catch (error) {
    console.error('[demo-events] Ingestion failed:', error);
  }

  return NextResponse.json({ ok: true });
}
