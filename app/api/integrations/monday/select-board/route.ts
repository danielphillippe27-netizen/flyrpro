import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  fetchMondayBoards,
  resolveMondayColumnMapping,
  validateMondayBoardSelection,
  type MondayProviderConfig,
} from '@/app/api/integrations/monday/_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const boardId = typeof body?.boardId === 'string' ? body.boardId : '';
    if (!boardId) {
      return NextResponse.json({ error: 'boardId is required' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: integration, error } = await supabase
      .from('user_integrations')
      .select('id, access_token, provider_config')
      .eq('user_id', requestUser.id)
      .eq('provider', 'monday')
      .maybeSingle();

    if (error) throw error;
    if (!integration?.access_token) {
      return NextResponse.json({ error: 'Monday.com is not connected' }, { status: 400 });
    }

    const boards = await fetchMondayBoards(integration.access_token);
    const board = boards.find((candidate) => candidate.id === boardId);
    if (!board) {
      return NextResponse.json({ error: 'Selected board was not found' }, { status: 404 });
    }

    await validateMondayBoardSelection(integration.access_token, board.id);

    const providerConfig: MondayProviderConfig = {
      workspaceId: board.workspace?.id ?? null,
      workspaceName: board.workspace?.name ?? null,
      columnMapping: resolveMondayColumnMapping(
        board.columns,
        integration.provider_config?.columnMapping ?? null
      ),
    };

    const { error: updateError } = await supabase
      .from('user_integrations')
      .update({
        selected_board_id: board.id,
        selected_board_name: board.name,
        provider_config: providerConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', integration.id);

    if (updateError) throw updateError;

    console.log('[monday/select-board] saved board selection', {
      userId: requestUser.id,
      boardId: board.id,
      boardName: board.name,
    });

    return NextResponse.json({
      success: true,
      selectedBoardId: board.id,
      selectedBoardName: board.name,
    });
  } catch (error) {
    console.error('[monday/select-board]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save monday board' },
      { status: 500 }
    );
  }
}
