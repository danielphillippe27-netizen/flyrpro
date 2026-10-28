import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { gmailConfig, googleToken, seal, unseal } from '@/lib/outreach/gmail';
export async function GET(request: NextRequest) {
  if(request.nextUrl.searchParams.get('state')?.startsWith('coco.')) return (await import('@/app/api/coco/gmail/callback/route')).GET(request);
  let result = 'error';
  try {
    const state = unseal<{ userId: string; state: string; verifier: string; expires: number }>(request.cookies.get('wolfgrid-gmail-connect')?.value ?? '');
    if (state.state !== request.nextUrl.searchParams.get('state') || state.expires < Date.now()) throw new Error('Invalid state');
    const user = await resolveUserFromRequest(request);
    if (user && user.id !== state.userId) throw new Error('Account changed');
    const code = request.nextUrl.searchParams.get('code');
    if (!code || request.nextUrl.searchParams.has('error')) throw new Error('Authorization declined');
    const tokens = await googleToken({ grant_type: 'authorization_code', code, redirect_uri: gmailConfig().redirectUri, code_verifier: state.verifier });
    if (!tokens.refresh_token || !tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.send')) throw new Error('Missing permission');
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000) });
    if (!profileResponse.ok) throw new Error('Profile unavailable');
    const profile = await profileResponse.json() as { email?: string; email_verified?: boolean };
    if (!profile.email || !profile.email_verified) throw new Error('Email not verified');
    const { error } = await createAdminClient().from('personal_gmail_connections').upsert({ user_id: state.userId, email: profile.email, tokens_encrypted: seal({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 }), updated_at: new Date().toISOString() });
    if (error) throw new Error('Save failed');
    result = 'connected';
  } catch { /* Do not expose codes or tokens in logs or redirects. */ }
  const response = NextResponse.redirect(new URL(`/settings/integrations?gmail=${result}`, request.url));
  response.cookies.set('wolfgrid-gmail-connect', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/outreach/gmail', maxAge: 0 });
  return response;
}
