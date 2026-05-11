import { NextRequest, NextResponse } from 'next/server';
import { getMetaConnectionForUser, requireMetaUser } from '../_lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireMetaUser(request);
    if (auth instanceof NextResponse) return auth;

    const connection = await getMetaConnectionForUser(auth.admin, auth.user.id);
    if (!connection) {
      return NextResponse.json({ disconnected: true });
    }

    await auth.admin
      .from('farm_meta_campaign_links')
      .update({
        meta_connection_id: null,
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', auth.user.id)
      .eq('meta_connection_id', connection.id);

    const { error } = await auth.admin
      .from('meta_connections')
      .delete()
      .eq('id', connection.id)
      .eq('user_id', auth.user.id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ disconnected: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to disconnect Meta Ads.' },
      { status: 500 }
    );
  }
}
