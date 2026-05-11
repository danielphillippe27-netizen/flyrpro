import { NextRequest, NextResponse } from 'next/server';
import { getMetaConnectionForUser, publicMetaConnection, requireMetaUser } from '../_lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireMetaUser(request);
    if (auth instanceof NextResponse) return auth;

    const connection = await getMetaConnectionForUser(auth.admin, auth.user.id);
    return NextResponse.json(publicMetaConnection(connection));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load Meta connection.' },
      { status: 500 }
    );
  }
}
