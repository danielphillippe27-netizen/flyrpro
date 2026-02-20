import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomBytes } from 'crypto';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getSupabaseAnonKey,
  getSupabaseJwtSecret,
  getSupabaseUrl,
} from '@/lib/supabase/env';

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createShortLivedAccessToken(userId: string): string {
  const supabaseUrl = getSupabaseUrl();
  const supabaseJwtSecret = getSupabaseJwtSecret();

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'authenticated',
    exp: now + 15 * 60,
    iat: now,
    iss: `${supabaseUrl}/auth/v1`,
    role: 'authenticated',
    sub: userId,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', supabaseJwtSecret).update(signingInput).digest();
  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    const body = await request.json().catch(() => ({}));
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!code) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    const { data: redeemed, error: redeemError } = await admin
      .from('auth_handoffs')
      .update({ used_at: nowIso })
      .eq('code', code)
      .is('used_at', null)
      .gt('expires_at', nowIso)
      .select('user_id')
      .single();

    if (redeemError || !redeemed?.user_id) {
      return NextResponse.json(
        { error: 'Invalid or expired handoff code' },
        { status: 400 }
      );
    }

    const response = NextResponse.json({ ok: true });
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    const accessToken = createShortLivedAccessToken(redeemed.user_id);
    const refreshToken = randomBytes(32).toString('base64url');
    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (setSessionError) {
      return NextResponse.json({ error: 'Failed to establish web session' }, { status: 500 });
    }

    return response;
  } catch (error) {
    console.error('Redeem handoff error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
