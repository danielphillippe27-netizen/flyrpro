import { NextRequest, NextResponse } from 'next/server';
import {
  getPostAuthRedirect,
  getPostAuthRedirectForUserId,
} from '@/app/lib/post-auth-gate';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

/**
 * GET /api/access/redirect
 * Returns where the current user should be (onboarding, subscribe, or home). For client-side guards.
 */
export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    const result = requestUser
      ? await getPostAuthRedirectForUserId(requestUser.id, {})
      : await getPostAuthRedirect({});
    return NextResponse.json({ redirect: result.redirect, path: result.path });
  } catch (e) {
    console.error('Access redirect error:', e);
    return NextResponse.json(
      { error: 'Unauthorized', redirect: 'login', path: '/login' },
      { status: 401 }
    );
  }
}
