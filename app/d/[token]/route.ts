import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  buildDemoLinkDestination,
  recordDemoLinkOpen,
  resolveDemoLinkByToken,
} from '@/lib/dialer/demo-link-tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const cleanToken = decodeURIComponent(token ?? '').trim();
  const fallbackUrl = new URL('/demo1', request.nextUrl.origin);

  if (!cleanToken) {
    return NextResponse.redirect(fallbackUrl);
  }

  const admin = createAdminClient();
  const link = await resolveDemoLinkByToken(admin, cleanToken);
  if (!link) {
    return NextResponse.redirect(fallbackUrl);
  }

  await recordDemoLinkOpen({ admin, request, link });
  return NextResponse.redirect(buildDemoLinkDestination(link, request));
}
