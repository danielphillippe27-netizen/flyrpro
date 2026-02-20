import { NextRequest, NextResponse } from 'next/server';
import { getPostAuthRedirect } from '@/app/lib/post-auth-gate';

/**
 * Central post-auth gate: redirects to onboarding, subscribe, or dashboard.
 * Auth callback should redirect here instead of /home.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const inviteToken = searchParams.get('token') ?? null;
  const next = searchParams.get('next') ?? null;

  const result = await getPostAuthRedirect({ inviteToken, next });
  const path = result.redirect === 'subscribe' ? '/home' : result.path;
  return NextResponse.redirect(new URL(path, request.url));
}
