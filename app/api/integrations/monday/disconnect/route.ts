import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('user_integrations')
      .delete()
      .eq('user_id', requestUser.id)
      .eq('provider', 'monday');

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Successfully disconnected from Monday.com',
    });
  } catch (error) {
    console.error('[monday/disconnect]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to disconnect monday' },
      { status: 500 }
    );
  }
}
