import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { gmailConfig, seal } from '@/lib/outreach/gmail';
export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const config = gmailConfig();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid email https://www.googleapis.com/auth/gmail.send', access_type: 'offline', prompt: 'consent select_account', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    const response = NextResponse.json({ url: url.toString() });
    response.cookies.set('wolfgrid-gmail-connect', seal({ userId: user.id, state, verifier, expires: Date.now() + 600_000 }), { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/outreach/gmail', maxAge: 600 });
    return response;
  } catch { return NextResponse.json({ error: 'Gmail connection setup is not available yet.' }, { status: 503 }); }
}
