import { NextRequest } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import {
  CHAT_PAGE_SIZE,
  CHAT_VOICE_BUCKET,
  MessageRow,
  SessionChatError,
  decodeCursor,
  encodeCursor,
  errorResponse,
  getChatContext,
  requireUuid,
  serializeMessages,
  validateText,
  validateVoice,
} from '@/app/api/live-sessions/chat/_lib/session-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESSAGE_SELECT =
  'id,session_id,campaign_id,workspace_id,sender_user_id,client_message_id,message_type,text_body,audio_path,audio_duration_ms,created_at';

async function authenticatedUser(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) throw new SessionChatError('Unauthorized', 401);
  return user;
}

export async function GET(request: NextRequest) {
  try {
    const user = await authenticatedUser(request);
    const sessionId = requireUuid(request.nextUrl.searchParams.get('sessionId'), 'sessionId');
    const cursor = decodeCursor(request.nextUrl.searchParams.get('cursor'));
    const admin = createAdminClient();
    const context = await getChatContext(admin, user.id, sessionId);

    let query = admin
      .from('session_chat_messages')
      .select(MESSAGE_SELECT)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CHAT_PAGE_SIZE + 1);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }

    const { data, error } = await query;
    if (error) throw new SessionChatError('Unable to load messages.', 500, error);
    const rows = (data ?? []) as MessageRow[];
    const hasMore = rows.length > CHAT_PAGE_SIZE;
    const page = rows.slice(0, CHAT_PAGE_SIZE);
    const messages = await serializeMessages(admin, page.reverse());
    const oldest = page[0];

    const unreadSince = context.participant.chat_last_read_at ?? context.participant.joined_at;
    const { count: unreadCount, error: unreadError } = await admin
      .from('session_chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .neq('sender_user_id', user.id)
      .gt('created_at', unreadSince);
    if (unreadError) throw new SessionChatError('Unable to calculate unread messages.', 500, unreadError);

    return Response.json({
      messages,
      nextCursor: hasMore && oldest ? encodeCursor(oldest) : null,
      canSend: context.canSend,
      endedAt: context.session.end_time,
      unreadCount: unreadCount ?? 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let uploadedPath: string | null = null;
  let uploadedNewVoiceFile = false;
  try {
    const user = await authenticatedUser(request);
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
    let sessionId: string;
    let clientMessageId: string;
    let textBody: string | null = null;
    let voiceFile: File | null = null;
    let durationMs: number | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      sessionId = requireUuid(form.get('sessionId') ?? form.get('session_id'), 'sessionId');
      clientMessageId = requireUuid(
        form.get('clientMessageId') ?? form.get('client_message_id'),
        'clientMessageId'
      );
      const fileValue = form.get('voice') ?? form.get('audio');
      if (!(fileValue instanceof File)) throw new SessionChatError('A voice file is required.', 400);
      voiceFile = fileValue;
      durationMs = validateVoice(voiceFile, form.get('durationMs') ?? form.get('duration_ms'));
    } else {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) throw new SessionChatError('Invalid JSON body.', 400);
      sessionId = requireUuid(body.sessionId ?? body.session_id, 'sessionId');
      clientMessageId = requireUuid(
        body.clientMessageId ?? body.client_message_id,
        'clientMessageId'
      );
      const type = body.type ?? body.messageType ?? body.message_type;
      if (type !== 'text') throw new SessionChatError('JSON messages must have type "text".', 400);
      textBody = validateText(body.text);
    }

    const admin = createAdminClient();
    const context = await getChatContext(admin, user.id, sessionId);

    const { data: duplicateData, error: duplicateError } = await admin
      .from('session_chat_messages')
      .select(MESSAGE_SELECT)
      .eq('session_id', sessionId)
      .eq('sender_user_id', user.id)
      .eq('client_message_id', clientMessageId)
      .maybeSingle();
    if (duplicateError) throw new SessionChatError('Unable to check message status.', 500, duplicateError);
    if (duplicateData) {
      const [message] = await serializeMessages(admin, [duplicateData as MessageRow]);
      return Response.json({ message, duplicate: true });
    }

    if (!context.canSend) {
      throw new SessionChatError('This session has ended or you already left it.', 409);
    }

    if (voiceFile) {
      const extension = voiceFile.type === 'audio/aac' ? 'aac' : 'm4a';
      uploadedPath = `${context.session.workspace_id ?? 'no-workspace'}/${context.session.campaign_id}/${sessionId}/${user.id}/${clientMessageId}.${extension}`;
      const bytes = await voiceFile.arrayBuffer();
      const { error: uploadError } = await admin.storage
        .from(CHAT_VOICE_BUCKET)
        .upload(uploadedPath, bytes, { contentType: voiceFile.type, upsert: false });
      uploadedNewVoiceFile = !uploadError;
      if (uploadError && !uploadError.message.toLowerCase().includes('already exists')) {
        throw new SessionChatError('Unable to upload the voice note.', 500, uploadError);
      }
    }

    const insert = {
      session_id: sessionId,
      campaign_id: context.session.campaign_id,
      workspace_id: context.session.workspace_id,
      sender_user_id: user.id,
      client_message_id: clientMessageId,
      message_type: voiceFile ? 'voice' : 'text',
      text_body: textBody,
      audio_path: uploadedPath,
      audio_duration_ms: durationMs,
    };
    const { data: insertedData, error: insertError } = await admin
      .from('session_chat_messages')
      .insert(insert)
      .select(MESSAGE_SELECT)
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: retryData } = await admin
          .from('session_chat_messages')
          .select(MESSAGE_SELECT)
          .eq('session_id', sessionId)
          .eq('sender_user_id', user.id)
          .eq('client_message_id', clientMessageId)
          .single();
        if (retryData) {
          const [message] = await serializeMessages(admin, [retryData as MessageRow]);
          return Response.json({ message, duplicate: true });
        }
      }
      if (uploadedNewVoiceFile && uploadedPath) {
        await admin.storage.from(CHAT_VOICE_BUCKET).remove([uploadedPath]);
      }
      throw new SessionChatError('Unable to send this message.', 500, insertError);
    }

    const [message] = await serializeMessages(admin, [insertedData as MessageRow]);
    return Response.json({ message, duplicate: false }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
