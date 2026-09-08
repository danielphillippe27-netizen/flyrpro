import type { createAdminClient } from '@/lib/supabase/server';

export const CHAT_VOICE_BUCKET = 'session-chat-voice';
export const CHAT_VOICE_MAX_BYTES = 4 * 1024 * 1024;
export const CHAT_VOICE_MIN_DURATION_MS = 1_000;
export const CHAT_VOICE_MAX_DURATION_MS = 120_000;
export const CHAT_SIGNED_URL_TTL_SECONDS = 60 * 60;
export const CHAT_PAGE_SIZE = 50;
export const CHAT_ROOM_PAGE_SIZE = 30;

export const CHAT_VOICE_MIME_TYPES = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
]);

type AdminClient = ReturnType<typeof createAdminClient>;

export type SessionRow = {
  id: string;
  user_id: string;
  campaign_id: string | null;
  workspace_id: string | null;
  start_time: string;
  end_time: string | null;
};

export type ParticipantRow = {
  id: string;
  session_id: string;
  campaign_id: string;
  user_id: string;
  role: 'host' | 'member';
  joined_at: string;
  left_at: string | null;
  last_seen_at: string;
  chat_last_read_at: string | null;
  chat_last_read_message_id: string | null;
};

export type MessageRow = {
  id: string;
  session_id: string;
  campaign_id: string;
  workspace_id: string | null;
  sender_user_id: string;
  client_message_id: string;
  message_type: 'text' | 'voice';
  text_body: string | null;
  audio_path: string | null;
  audio_duration_ms: number | null;
  created_at: string;
};

export type ChatContext = {
  session: SessionRow;
  participant: ParticipantRow;
  canSend: boolean;
};

export class SessionChatError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field: string): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!UUID_PATTERN.test(candidate)) {
    throw new SessionChatError(`${field} must be a valid UUID.`, 400);
  }
  return candidate;
}

export function validateText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 1 || text.length > 1_000) {
    throw new SessionChatError('Text must contain between 1 and 1,000 characters.', 400);
  }
  return text;
}

export function validateVoice(file: File, durationMsValue: unknown): number {
  const durationMs = Number(durationMsValue);
  if (!Number.isInteger(durationMs) || durationMs < CHAT_VOICE_MIN_DURATION_MS || durationMs > CHAT_VOICE_MAX_DURATION_MS) {
    throw new SessionChatError('Voice notes must be between 1 and 120 seconds.', 400);
  }
  if (file.size < 1 || file.size > CHAT_VOICE_MAX_BYTES) {
    throw new SessionChatError('Voice notes must be no larger than 4 MB.', 400);
  }
  if (!CHAT_VOICE_MIME_TYPES.has(file.type.toLowerCase())) {
    throw new SessionChatError('Voice notes must use an approved AAC or M4A MIME type.', 415);
  }
  return durationMs;
}

export async function getChatContext(
  admin: AdminClient,
  userId: string,
  sessionId: string
): Promise<ChatContext> {
  const [{ data: sessionData, error: sessionError }, { data: participantData, error: participantError }] =
    await Promise.all([
      admin
        .from('sessions')
        .select('id,user_id,campaign_id,workspace_id,start_time,end_time')
        .eq('id', sessionId)
        .maybeSingle(),
      admin
        .from('session_participants')
        .select('id,session_id,campaign_id,user_id,role,joined_at,left_at,last_seen_at,chat_last_read_at,chat_last_read_message_id')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

  if (sessionError || participantError) {
    throw new SessionChatError('Unable to load this team chat.', 500, sessionError ?? participantError);
  }
  const session = sessionData as SessionRow | null;
  const participant = participantData as ParticipantRow | null;
  if (!session) throw new SessionChatError('Session chat not found.', 404);
  if (!session.campaign_id || !participant) {
    throw new SessionChatError('You did not participate in this session.', 403);
  }

  const { data: canView, error: membershipError } = await admin.rpc('can_view_campaign', {
    p_campaign_id: session.campaign_id,
    p_user_id: userId,
  });
  if (membershipError) {
    throw new SessionChatError('Unable to authorize this team chat.', 500, membershipError);
  }
  if (!canView) {
    throw new SessionChatError('You no longer have access to this campaign.', 403);
  }

  return {
    session,
    participant,
    canSend: session.end_time === null && participant.left_at === null,
  };
}

function participantDisplayName(email: string | null, metadata: Record<string, unknown> | undefined) {
  for (const value of [metadata?.full_name, metadata?.name, metadata?.display_name]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return email?.split('@')[0]?.trim() || 'Teammate';
}

export async function senderDirectory(admin: AdminClient, userIds: string[]) {
  const unique = [...new Set(userIds)];
  const entries = await Promise.all(
    unique.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      const user = data.user;
      const metadata = user?.user_metadata as Record<string, unknown> | undefined;
      const avatarValue = metadata?.avatar_url ?? metadata?.picture;
      return [
        id,
        {
          id,
          name: participantDisplayName(user?.email ?? null, metadata),
          avatarUrl: typeof avatarValue === 'string' ? avatarValue : null,
        },
      ] as const;
    })
  );
  return new Map(entries);
}

export async function serializeMessages(admin: AdminClient, rows: MessageRow[]) {
  const directory = await senderDirectory(admin, rows.map((row) => row.sender_user_id));
  return Promise.all(
    rows.map(async (row) => {
      let audioUrl: string | null = null;
      if (row.audio_path) {
        const { data, error } = await admin.storage
          .from(CHAT_VOICE_BUCKET)
          .createSignedUrl(row.audio_path, CHAT_SIGNED_URL_TTL_SECONDS);
        if (error) console.error('[session-chat] signed URL failed:', error);
        audioUrl = data?.signedUrl ?? null;
      }
      return {
        id: row.id,
        sessionId: row.session_id,
        campaignId: row.campaign_id,
        clientMessageId: row.client_message_id,
        type: row.message_type,
        text: row.text_body,
        audioUrl,
        durationMs: row.audio_duration_ms,
        createdAt: row.created_at,
        sender: directory.get(row.sender_user_id) ?? {
          id: row.sender_user_id,
          name: 'Teammate',
          avatarUrl: null,
        },
      };
    })
  );
}

export function encodeCursor(row: Pick<MessageRow, 'id' | 'created_at'>): string {
  return Buffer.from(JSON.stringify({ id: row.id, createdAt: row.created_at })).toString('base64url');
}

export function decodeCursor(value: string | null): { id: string; createdAt: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      id?: unknown;
      createdAt?: unknown;
    };
    if (typeof parsed.createdAt !== 'string') return null;
    const timestamp = new Date(parsed.createdAt);
    if (Number.isNaN(timestamp.getTime())) return null;
    return { id: requireUuid(parsed.id, 'cursor id'), createdAt: timestamp.toISOString() };
  } catch {
    throw new SessionChatError('Invalid pagination cursor.', 400);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof SessionChatError) {
    if (error.status >= 500) console.error('[session-chat]', error.message, error.cause);
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error('[session-chat] unexpected failure:', error);
  return Response.json({ error: 'Unable to complete the team chat request.' }, { status: 500 });
}
