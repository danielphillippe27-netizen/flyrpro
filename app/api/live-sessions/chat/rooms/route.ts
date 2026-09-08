import { NextRequest } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import {
  CHAT_ROOM_PAGE_SIZE,
  MessageRow,
  ParticipantRow,
  SessionChatError,
  SessionRow,
  errorResponse,
  serializeMessages,
} from '@/app/api/live-sessions/chat/_lib/session-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function decodeRoomCursor(value: string | null) {
  if (!value) return 0;
  try {
    const offset = Number(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Number.isInteger(offset) || offset < 0) throw new Error('bad cursor');
    return offset;
  } catch {
    throw new SessionChatError('Invalid pagination cursor.', 400);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) throw new SessionChatError('Unauthorized', 401);
    const offset = decodeRoomCursor(request.nextUrl.searchParams.get('cursor'));
    const admin = createAdminClient();
    const participants: ParticipantRow[] = [];
    const batchSize = 1_000;
    for (let start = 0; ; start += batchSize) {
      const { data: participantData, error: participantError } = await admin
        .from('session_participants')
        .select('id,session_id,campaign_id,user_id,role,joined_at,left_at,last_seen_at,chat_last_read_at,chat_last_read_message_id')
        .eq('user_id', user.id)
        .order('last_seen_at', { ascending: false })
        .range(start, start + batchSize - 1);
      if (participantError) {
        throw new SessionChatError('Unable to load team chats.', 500, participantError);
      }
      const batch = (participantData ?? []) as ParticipantRow[];
      participants.push(...batch);
      if (batch.length < batchSize) break;
    }

    const rooms = (
      await Promise.all(
        participants.map(async (participant) => {
          const [{ data: sessionData, error: sessionError }, { data: campaignData }, { data: roomParticipants }] =
            await Promise.all([
              admin
                .from('sessions')
                .select('id,user_id,campaign_id,workspace_id,start_time,end_time')
                .eq('id', participant.session_id)
                .maybeSingle(),
              admin.from('campaigns').select('id,title,name').eq('id', participant.campaign_id).maybeSingle(),
              admin
                .from('session_participants')
                .select('user_id,role,left_at')
                .eq('session_id', participant.session_id),
            ]);
          if (sessionError || !sessionData) return null;
          const session = sessionData as SessionRow;
          const { data: canView } = await admin.rpc('can_view_campaign', {
            p_campaign_id: participant.campaign_id,
            p_user_id: user.id,
          });
          if (!canView) return null;

          const { data: latestData, error: latestError } = await admin
            .from('session_chat_messages')
            .select('id,session_id,campaign_id,workspace_id,sender_user_id,client_message_id,message_type,text_body,audio_path,audio_duration_ms,created_at')
            .eq('session_id', participant.session_id)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestError) throw new SessionChatError('Unable to load chat previews.', 500, latestError);
          const latest = latestData as MessageRow | null;
          const [serializedLatest] = latest ? await serializeMessages(admin, [latest]) : [null];
          const unreadSince = participant.chat_last_read_at ?? participant.joined_at;
          const { count: unreadCount, error: unreadError } = await admin
            .from('session_chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', participant.session_id)
            .neq('sender_user_id', user.id)
            .gt('created_at', unreadSince);
          if (unreadError) throw new SessionChatError('Unable to calculate unread messages.', 500, unreadError);

          const memberRows = (roomParticipants ?? []) as Array<{ user_id: string; role: string; left_at: string | null }>;
          const directory = await Promise.all(
            memberRows.map(async (member) => {
              const { data } = await admin.auth.admin.getUserById(member.user_id);
              const metadata = data.user?.user_metadata as Record<string, unknown> | undefined;
              const rawName = metadata?.full_name ?? metadata?.name ?? metadata?.display_name;
              return {
                id: member.user_id,
                name:
                  (typeof rawName === 'string' && rawName.trim()) ||
                  data.user?.email?.split('@')[0] ||
                  'Teammate',
                avatarUrl:
                  typeof (metadata?.avatar_url ?? metadata?.picture) === 'string'
                    ? String(metadata?.avatar_url ?? metadata?.picture)
                    : null,
                role: member.role,
                isPresent: member.left_at === null && session.end_time === null,
              };
            })
          );
          const campaign = campaignData as { title?: string | null; name?: string | null } | null;
          return {
            sessionId: session.id,
            campaignId: participant.campaign_id,
            workspaceId: session.workspace_id,
            campaignName: campaign?.title || campaign?.name || 'Campaign',
            startedAt: session.start_time,
            endedAt: session.end_time,
            isActive: session.end_time === null,
            canSend: session.end_time === null && participant.left_at === null,
            participants: directory,
            participantCount: directory.length,
            latestMessage: serializedLatest,
            latestMessageAt: latest?.created_at ?? session.end_time ?? session.start_time,
            unreadCount: unreadCount ?? 0,
          };
        })
      )
    )
      .filter((room): room is NonNullable<typeof room> => room !== null)
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return Date.parse(b.latestMessageAt) - Date.parse(a.latestMessageAt);
      });
    const page = rooms.slice(offset, offset + CHAT_ROOM_PAGE_SIZE);
    const hasMore = rooms.length > offset + CHAT_ROOM_PAGE_SIZE;

    return Response.json({
      rooms: page,
      nextCursor: hasMore ? Buffer.from(String(offset + CHAT_ROOM_PAGE_SIZE)).toString('base64url') : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
