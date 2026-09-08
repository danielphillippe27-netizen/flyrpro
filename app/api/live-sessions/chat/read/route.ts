import { NextRequest } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import {
  SessionChatError,
  errorResponse,
  getChatContext,
  requireUuid,
} from '@/app/api/live-sessions/chat/_lib/session-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) throw new SessionChatError('Unauthorized', 401);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new SessionChatError('Invalid JSON body.', 400);
    const sessionId = requireUuid(body.sessionId ?? body.session_id, 'sessionId');
    const requestedMessageId = body.lastReadMessageId ?? body.last_read_message_id;
    const messageId = requestedMessageId ? requireUuid(requestedMessageId, 'lastReadMessageId') : null;
    const admin = createAdminClient();
    const context = await getChatContext(admin, user.id, sessionId);

    let query = admin
      .from('session_chat_messages')
      .select('id,created_at')
      .eq('session_id', sessionId);
    query = messageId
      ? query.eq('id', messageId).limit(1)
      : query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1);
    const { data, error } = await query.maybeSingle();
    if (error) throw new SessionChatError('Unable to locate the read marker.', 500, error);
    if (!data) return Response.json({ success: true, lastReadMessageId: null });

    const current = context.participant.chat_last_read_at;
    if (!current || new Date(data.created_at) > new Date(current)) {
      const { error: updateError } = await admin
        .from('session_participants')
        .update({
          chat_last_read_at: data.created_at,
          chat_last_read_message_id: data.id,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', context.participant.id);
      if (updateError) throw new SessionChatError('Unable to update the read marker.', 500, updateError);
    }

    return Response.json({ success: true, lastReadMessageId: data.id, readAt: data.created_at });
  } catch (error) {
    return errorResponse(error);
  }
}
