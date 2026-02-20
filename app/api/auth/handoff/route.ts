import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';

const DEFAULT_SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://kfnsnwqylsdsbgnwgxva.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getCleanSupabaseUrl(): string {
  return (DEFAULT_SUPABASE_URL || '').trim().replace(/\/$/, '') || DEFAULT_SUPABASE_URL;
}

function buildClientIp(request: NextRequest): string | null {
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const first = xForwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const xRealIp = request.headers.get('x-real-ip')?.trim();
  return xRealIp || null;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ') || !SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(getCleanSupabaseUrl(), SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const { count: activeCount, error: activeCountError } = await admin
      .from('auth_handoffs')
      .select('code', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('used_at', null)
      .gt('expires_at', nowIso);

    if (activeCountError) {
      return NextResponse.json({ error: 'Failed to create handoff' }, { status: 500 });
    }
    if ((activeCount ?? 0) >= 5) {
      return NextResponse.json(
        { error: 'Too many active handoff codes. Try again in a minute.' },
        { status: 429 }
      );
    }

    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const userAgent = request.headers.get('user-agent');
    const ip = buildClientIp(request);

    const { error: insertError } = await admin.from('auth_handoffs').insert({
      code,
      user_id: user.id,
      expires_at: expiresAt,
      user_agent: userAgent,
      ip,
    });

    if (insertError) {
      return NextResponse.json({ error: 'Failed to create handoff' }, { status: 500 });
    }

    return NextResponse.json({ code, expires_at: expiresAt });
  } catch (error) {
    console.error('Auth handoff error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
