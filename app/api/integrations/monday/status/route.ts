import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data: integration, error } = await supabase
      .from('user_integrations')
      .select('account_id, account_name, selected_board_id, selected_board_name, updated_at')
      .eq('user_id', requestUser.id)
      .eq('provider', 'monday')
      .maybeSingle();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      connected: !!integration,
      accountId: integration?.account_id ?? null,
      accountName: integration?.account_name ?? null,
      selectedBoardId: integration?.selected_board_id ?? null,
      selectedBoardName: integration?.selected_board_name ?? null,
      needsBoardSelection: !!integration && !integration?.selected_board_id,
      updatedAt: integration?.updated_at ?? null,
    });
  } catch (error) {
    console.error('[monday/status]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load monday status' },
      { status: 500 }
    );
  }
}
