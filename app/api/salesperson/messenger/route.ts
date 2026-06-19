import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  getInviteAppOrigin,
  sendSalespersonMessengerEmail,
} from '@/lib/email/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERAL_THREAD_KEY = 'salespeople-general';
const GENERAL_THREAD_TITLE = 'Sales Floor';
const MAX_BODY_LENGTH = 1200;
const MAX_GIF_TITLE_LENGTH = 120;
const MAX_GIF_URL_LENGTH = 1000;
const NOTIFICATION_THROTTLE_MS = 2 * 60 * 60 * 1000;
const MESSENGER_NOTIFICATION_TYPE = 'salesperson_messenger_message';

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  workspace_id: string | null;
  founder_user_id?: string | null;
};

type ThreadRow = {
  id: string;
  key: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_user_id: string;
  salesperson_id: string | null;
  body: string | null;
  gif_url: string | null;
  gif_title: string | null;
  message_type: 'text' | 'gif' | 'mixed';
  created_at: string;
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  profile_image_url: string | null;
};

type UserProfileRow = {
  user_id: string;
  is_founder: boolean | null;
};

type RecipientProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type MessengerNotificationRecipient = {
  userId: string;
  email: string | null;
  name: string;
};

type MessagePayload = {
  workspaceId?: unknown;
  body?: unknown;
  gifUrl?: unknown;
  gifTitle?: unknown;
};

function isMessengerStorageMissing(error: { message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? '';
  return (
    (message.includes('salesperson_messenger_threads') ||
      message.includes('salesperson_messenger_messages')) &&
    (message.includes('does not exist') ||
      message.includes('could not find the table') ||
      message.includes('schema cache'))
  );
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeGifUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_GIF_URL_LENGTH) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function messageType(body: string | null, gifUrl: string | null): 'text' | 'gif' | 'mixed' {
  if (body && gifUrl) return 'mixed';
  if (gifUrl) return 'gif';
  return 'text';
}

function displayName(profile: ProfileRow | undefined, salesperson: SalespersonRow | null): string {
  const profileName =
    profile?.full_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  if (profileName) return profileName;
  if (salesperson?.full_name) return salesperson.full_name;
  return profile?.email ?? salesperson?.email ?? 'Salesperson';
}

function previewForMessage(body: string | null, gifUrl: string | null, gifTitle: string | null): string {
  const text = body?.trim();
  if (text) return text.slice(0, 160);
  if (gifTitle?.trim()) return `GIF: ${gifTitle.trim()}`.slice(0, 160);
  if (gifUrl) return 'GIF';
  return 'Message';
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function getRequestOrigin(request: NextRequest): string {
  return getInviteAppOrigin(request.nextUrl.origin);
}

async function resolveActiveSalesperson(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; email: string | null },
  workspaceId: string | null
): Promise<SalespersonRow | null> {
  const select = 'id, full_name, email, workspace_id, founder_user_id';
  const normalizedEmail = normalizeEmail(user.email);

  if (workspaceId && normalizedEmail) {
    const { data, error } = await admin
      .from('salespeople')
      .select(select)
      .eq('workspace_id', workspaceId)
      .ilike('email', normalizedEmail)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) return data as SalespersonRow;
  }

  if (workspaceId && !normalizedEmail) {
    const { data: membership, error: membershipError } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) throw new Error(membershipError.message);

    if (membership?.workspace_id) {
      const { data, error } = await admin
        .from('salespeople')
        .select(select)
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (data) return data as SalespersonRow;
    }
  }

  if (!normalizedEmail) return null;

  const { data, error } = await admin
    .from('salespeople')
    .select(select)
    .ilike('email', normalizedEmail)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalespersonRow | null) ?? null;
}

async function loadSalespersonMessengerRecipients(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string | null,
  senderUserId: string
): Promise<MessengerNotificationRecipient[]> {
  if (!workspaceId) return [];

  const { data: salespeopleData, error: salespeopleError } = await admin
    .from('salespeople')
    .select('id, full_name, email, workspace_id, founder_user_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');

  if (salespeopleError) throw new Error(salespeopleError.message);

  const salespeople = (salespeopleData ?? []) as SalespersonRow[];
  if (salespeople.length === 0) return [];

  const salespersonEmails = Array.from(
    new Set(salespeople.map((row) => normalizeEmail(row.email)).filter((email): email is string => Boolean(email)))
  );
  const founderUserIds = Array.from(
    new Set(salespeople.map((row) => row.founder_user_id).filter((id): id is string => Boolean(id)))
  );

  const [salespersonProfilesResult, founderProfilesResult] = await Promise.all([
    salespersonEmails.length
      ? admin.from('profiles').select('id, email, full_name').in('email', salespersonEmails)
      : Promise.resolve({ data: [], error: null }),
    founderUserIds.length
      ? admin.from('profiles').select('id, email, full_name').in('id', founderUserIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (salespersonProfilesResult.error) throw new Error(salespersonProfilesResult.error.message);
  if (founderProfilesResult.error) throw new Error(founderProfilesResult.error.message);

  const salespersonProfileByEmail = new Map(
    ((salespersonProfilesResult.data ?? []) as RecipientProfileRow[])
      .map((profile) => [normalizeEmail(profile.email), profile] as const)
      .filter(([email]) => Boolean(email))
  );
  const founderProfileByUserId = new Map(
    ((founderProfilesResult.data ?? []) as RecipientProfileRow[]).map((profile) => [profile.id, profile])
  );
  const recipientsByUserId = new Map<string, MessengerNotificationRecipient>();

  for (const salesperson of salespeople) {
    const email = normalizeEmail(salesperson.email);
    const profile = email ? salespersonProfileByEmail.get(email) : null;
    if (!profile?.id || profile.id === senderUserId) continue;

    recipientsByUserId.set(profile.id, {
      userId: profile.id,
      email: normalizeEmail(profile.email) ?? email,
      name: profile.full_name?.trim() || salesperson.full_name || profile.email || 'Salesperson',
    });
  }

  await Promise.all(
    founderUserIds.map(async (userId) => {
      if (userId === senderUserId || recipientsByUserId.has(userId)) return;

      const profile = founderProfileByUserId.get(userId);
      let email = normalizeEmail(profile?.email);
      if (!email) {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (!error) email = normalizeEmail(data?.user?.email);
      }

      recipientsByUserId.set(userId, {
        userId,
        email,
        name: profile?.full_name?.trim() || email || 'Founder',
      });
    })
  );

  return Array.from(recipientsByUserId.values());
}

async function notifySalespersonMessengerRecipients(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string | null;
  threadId: string;
  messageId: string;
  senderUserId: string;
  senderName: string;
  senderSalespersonId: string | null;
  preview: string;
  request: NextRequest;
}): Promise<void> {
  const {
    admin,
    workspaceId,
    threadId,
    messageId,
    senderUserId,
    senderName,
    senderSalespersonId,
    preview,
    request,
  } = params;

  if (!workspaceId) return;

  const recipients = await loadSalespersonMessengerRecipients(admin, workspaceId, senderUserId);
  if (recipients.length === 0) return;

  const recipientIds = recipients.map((recipient) => recipient.userId);
  const throttleStart = new Date(Date.now() - NOTIFICATION_THROTTLE_MS).toISOString();
  const { data: recentNotifications, error: recentNotificationsError } = await admin
    .from('notifications')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('type', MESSENGER_NOTIFICATION_TYPE)
    .in('user_id', recipientIds)
    .gte('created_at', throttleStart);

  if (recentNotificationsError) throw new Error(recentNotificationsError.message);

  const recentlyNotifiedUserIds = new Set(
    ((recentNotifications ?? []) as Array<{ user_id: string }>).map((row) => row.user_id)
  );
  const eligibleRecipients = recipients.filter(
    (recipient) => !recentlyNotifiedUserIds.has(recipient.userId)
  );

  if (eligibleRecipients.length === 0) return;

  const messageUrl = new URL('/home', getRequestOrigin(request)).toString();
  const notificationRows = eligibleRecipients.map((recipient) => ({
    workspace_id: workspaceId,
    user_id: recipient.userId,
    type: MESSENGER_NOTIFICATION_TYPE,
    title: `New Sales Floor message from ${senderName}`,
    body: preview,
    data: {
      link: '/home',
      label: 'Sales Floor',
      threadId,
      messageId,
      senderUserId,
      senderSalespersonId,
      throttleHours: 2,
    },
    read_at: null,
  }));

  const { error: insertError } = await admin.from('notifications').insert(notificationRows);
  if (insertError) throw new Error(insertError.message);

  await Promise.all(
    eligibleRecipients.map(async (recipient) => {
      if (!recipient.email) return;

      try {
        await sendSalespersonMessengerEmail({
          to: recipient.email,
          recipientName: recipient.name,
          senderName,
          preview,
          messageUrl,
          idempotencyKey: `salesperson-messenger:${messageId}:${recipient.userId}`,
        });
      } catch (error) {
        console.warn('[salesperson messenger] email notification failed', {
          userId: recipient.userId,
          error,
        });
      }
    })
  );
}

async function isFounderUser(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('user_id, is_founder')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean((data as UserProfileRow | null)?.is_founder);
}

async function ensureGeneralThread(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await admin
    .from('salesperson_messenger_threads')
    .upsert(
      {
        key: GENERAL_THREAD_KEY,
        title: GENERAL_THREAD_TITLE,
        created_by: userId,
      },
      { onConflict: 'key', ignoreDuplicates: false }
    )
    .select('id, key, title, created_at, updated_at, last_message_at, last_message_preview')
    .single();

  if (error) return { thread: null, error };
  return { thread: data as ThreadRow, error: null };
}

async function loadMessages(admin: ReturnType<typeof createAdminClient>, threadId: string) {
  const { data, error } = await admin
    .from('salesperson_messenger_messages')
    .select('id, thread_id, sender_user_id, salesperson_id, body, gif_url, gif_title, message_type, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) return { messages: [], error };
  return { messages: (data ?? []) as MessageRow[], error: null };
}

async function serializeMessages(
  admin: ReturnType<typeof createAdminClient>,
  messages: MessageRow[],
  currentUserId: string,
  currentSalesperson: SalespersonRow | null
) {
  const senderIds = Array.from(new Set(messages.map((message) => message.sender_user_id)));
  const salespersonIds = Array.from(
    new Set(messages.map((message) => message.salesperson_id).filter((id): id is string => Boolean(id)))
  );

  const [profilesResult, salespeopleResult] = await Promise.all([
    senderIds.length
      ? admin
          .from('profiles')
          .select('id, first_name, last_name, full_name, email, avatar_url, profile_image_url')
          .in('id', senderIds)
      : Promise.resolve({ data: [], error: null }),
    salespersonIds.length
      ? admin
          .from('salespeople')
          .select('id, full_name, email, workspace_id')
          .in('id', salespersonIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (salespeopleResult.error) throw new Error(salespeopleResult.error.message);

  const profilesById = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );
  const salespeopleById = new Map(
    ((salespeopleResult.data ?? []) as SalespersonRow[]).map((salesperson) => [salesperson.id, salesperson])
  );

  return messages.map((message) => {
    const profile = profilesById.get(message.sender_user_id);
    const salesperson = message.salesperson_id
      ? salespeopleById.get(message.salesperson_id) ?? null
      : null;

    return {
      id: message.id,
      threadId: message.thread_id,
      body: message.body,
      gifUrl: message.gif_url,
      gifTitle: message.gif_title,
      messageType: message.message_type,
      createdAt: message.created_at,
      isMine:
        message.sender_user_id === currentUserId &&
        message.salesperson_id === (currentSalesperson?.id ?? null),
      sender: {
        userId: message.sender_user_id,
        salespersonId: message.salesperson_id,
        name: displayName(profile, salesperson),
        avatarUrl: profile?.profile_image_url || profile?.avatar_url || null,
      },
    };
  });
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
  const admin = createAdminClient();

  try {
    const salesperson = await resolveActiveSalesperson(admin, requestUser, workspaceId);
    const founder = salesperson ? false : await isFounderUser(admin, requestUser.id);
    if (!salesperson && !founder) {
      return NextResponse.json({ error: 'Active salesperson access required' }, { status: 403 });
    }

    const { thread, error: threadError } = await ensureGeneralThread(admin, requestUser.id);
    if (threadError) {
      if (isMessengerStorageMissing(threadError)) {
        return NextResponse.json({ storageReady: false, thread: null, messages: [] });
      }
      throw new Error(threadError.message);
    }

    const { messages, error: messagesError } = await loadMessages(admin, thread.id);
    if (messagesError) {
      if (isMessengerStorageMissing(messagesError)) {
        return NextResponse.json({ storageReady: false, thread: null, messages: [] });
      }
      throw new Error(messagesError.message);
    }

    return NextResponse.json({
      storageReady: true,
      thread,
      currentSalesperson: {
        id: salesperson?.id ?? null,
        fullName: salesperson?.full_name ?? 'Founder',
        email: salesperson?.email ?? requestUser.email,
      },
      messages: await serializeMessages(admin, messages, requestUser.id, salesperson),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load messenger';
    console.error('[salesperson messenger] load failed', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as MessagePayload;
  const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId.trim() : null;
  const body = normalizeText(payload.body, MAX_BODY_LENGTH);
  const gifUrl = normalizeGifUrl(payload.gifUrl);
  const gifTitle = normalizeText(payload.gifTitle, MAX_GIF_TITLE_LENGTH);

  if (!body && !gifUrl) {
    return NextResponse.json({ error: 'Message or GIF is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    const salesperson = await resolveActiveSalesperson(admin, requestUser, workspaceId);
    const founder = salesperson ? false : await isFounderUser(admin, requestUser.id);
    if (!salesperson && !founder) {
      return NextResponse.json({ error: 'Active salesperson access required' }, { status: 403 });
    }

    const { thread, error: threadError } = await ensureGeneralThread(admin, requestUser.id);
    if (threadError) {
      if (isMessengerStorageMissing(threadError)) {
        return NextResponse.json(
          { error: 'Salesperson messenger storage is not ready yet.' },
          { status: 503 }
        );
      }
      throw new Error(threadError.message);
    }

    const { data, error: insertError } = await admin
      .from('salesperson_messenger_messages')
      .insert({
        thread_id: thread.id,
        sender_user_id: requestUser.id,
        salesperson_id: salesperson?.id ?? null,
        body,
        gif_url: gifUrl,
        gif_title: gifTitle,
        message_type: messageType(body, gifUrl),
      })
      .select('id, thread_id, sender_user_id, salesperson_id, body, gif_url, gif_title, message_type, created_at')
      .single();

    if (insertError) {
      if (isMessengerStorageMissing(insertError)) {
        return NextResponse.json(
          { error: 'Salesperson messenger storage is not ready yet.' },
          { status: 503 }
        );
      }
      throw new Error(insertError.message);
    }

    const preview = previewForMessage(body, gifUrl, gifTitle);
    await admin
      .from('salesperson_messenger_threads')
      .update({
        updated_at: new Date().toISOString(),
        last_message_at: (data as MessageRow).created_at,
        last_message_preview: preview,
      })
      .eq('id', thread.id);

    const savedMessage = data as MessageRow;
    const [message] = await serializeMessages(admin, [savedMessage], requestUser.id, salesperson);

    try {
      await notifySalespersonMessengerRecipients({
        admin,
        workspaceId: salesperson?.workspace_id ?? workspaceId,
        threadId: thread.id,
        messageId: savedMessage.id,
        senderUserId: requestUser.id,
        senderName: message?.sender?.name || salesperson?.full_name || requestUser.email || 'Sales Floor',
        senderSalespersonId: salesperson?.id ?? null,
        preview,
        request,
      });
    } catch (notificationError) {
      console.warn('[salesperson messenger] notification fan-out failed', notificationError);
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send message';
    console.error('[salesperson messenger] send failed', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
