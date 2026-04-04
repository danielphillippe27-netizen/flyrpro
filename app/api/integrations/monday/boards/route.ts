import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { fetchMondayBoards } from '@/app/api/integrations/monday/_lib/client';

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
      .select('access_token, account_id, account_name, selected_board_id, selected_board_name')
      .eq('user_id', requestUser.id)
      .eq('provider', 'monday')
      .maybeSingle();

    if (error) throw error;
    if (!integration?.access_token) {
      return NextResponse.json({ error: 'Monday.com is not connected' }, { status: 400 });
    }

    const boards = await fetchMondayBoards(integration.access_token);
    console.log('[monday/boards] fetched boards', {
      userId: requestUser.id,
      boardCount: boards.length,
      selectedBoardId: integration.selected_board_id ?? null,
    });

    return NextResponse.json({
      boards: boards.map((board) => ({
        id: board.id,
        name: board.name,
        state: board.state ?? null,
        workspaceId: board.workspace?.id ?? null,
        workspaceName: board.workspace?.name ?? null,
        columns: board.columns,
      })),
      accountId: integration.account_id ?? null,
      accountName: integration.account_name ?? null,
      selectedBoardId: integration.selected_board_id ?? null,
      selectedBoardName: integration.selected_board_name ?? null,
    });
  } catch (error) {
    console.error('[monday/boards]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load monday boards' },
      { status: 500 }
    );
  }
}
