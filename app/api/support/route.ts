import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SupportPostBody = {
  message?: unknown;
  page?: unknown;
};

const MIN_MESSAGE_LENGTH = 5;
const MAX_MESSAGE_LENGTH = 3000;

function preview(message: string) {
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: thread, error: threadError } = await admin
    .from('support_threads')
    .select('id, status, last_message_at, last_message_preview, unread_for_user')
    .eq('user_id', requestUser.id)
    .neq('status', 'closed')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (threadError) {
    return NextResponse.json({ error: threadError.message }, { status: 500 });
  }

  if (!thread?.id) {
    return NextResponse.json({
      threadId: null,
      status: null,
      lastMessageAt: null,
      lastMessagePreview: null,
      unreadForUser: false,
      messages: [],
    });
  }

  const { data: messages, error: messagesError } = await admin
    .from('support_messages')
    .select('id, thread_id, sender_type, body, created_at')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: true })
    .limit(100);

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  await admin
    .from('support_threads')
    .update({
      unread_for_user: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', thread.id)
    .eq('user_id', requestUser.id);

  return NextResponse.json({
    threadId: thread.id,
    status: thread.status ?? null,
    lastMessageAt: thread.last_message_at ?? null,
    lastMessagePreview: thread.last_message_preview ?? null,
    unreadForUser: thread.unread_for_user ?? false,
    messages: (messages ?? []).map((message) => ({
      id: message.id,
      threadId: message.thread_id,
      senderType: message.sender_type,
      body: message.body,
      createdAt: message.created_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as SupportPostBody;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < MIN_MESSAGE_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message must be ${MIN_MESSAGE_LENGTH}-${MAX_MESSAGE_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const page = typeof body.page === 'string' ? body.page.trim().slice(0, 512) : 'android-settings';

  await admin.from('profiles').upsert(
    {
      id: requestUser.id,
      email: requestUser.email ?? '',
      updated_at: now,
    },
    { onConflict: 'id' }
  );

  const { data: existingThread, error: existingThreadError } = await admin
    .from('support_threads')
    .select('id')
    .eq('user_id', requestUser.id)
    .neq('status', 'closed')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingThreadError) {
    return NextResponse.json({ error: existingThreadError.message }, { status: 500 });
  }

  let threadId = existingThread?.id ?? null;
  if (!threadId) {
    const { data: createdThread, error: createThreadError } = await admin
      .from('support_threads')
      .insert({
        user_id: requestUser.id,
        status: 'open',
        last_message_at: now,
        last_sender_type: 'user',
        last_message_preview: preview(message),
        needs_reply: true,
        unread_for_support: true,
        unread_for_user: false,
        updated_at: now,
      })
      .select('id')
      .single();

    if (createThreadError) {
      return NextResponse.json({ error: createThreadError.message }, { status: 500 });
    }
    threadId = createdThread.id;
  }

  const { data: insertedMessage, error: messageError } = await admin
    .from('support_messages')
    .insert({
      thread_id: threadId,
      sender_type: 'user',
      sender_user_id: requestUser.id,
      body: `${message}\n\n--\nSource: ${page}`,
    })
    .select('id, created_at')
    .single();

  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from('support_threads')
    .update({
      status: 'open',
      last_message_at: now,
      last_sender_type: 'user',
      last_message_id: insertedMessage.id,
      last_message_preview: preview(message),
      needs_reply: true,
      unread_for_support: true,
      unread_for_user: false,
      updated_at: now,
    })
    .eq('id', threadId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    threadId,
    messageId: insertedMessage.id,
    createdAt: insertedMessage.created_at,
  });
}
