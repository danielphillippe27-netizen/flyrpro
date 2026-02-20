import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

type ProfileLite = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type SupportThreadRow = {
  id: string;
  user_id: string;
  status: string | null;
  last_message_at: string | null;
  created_at: string;
  last_message_preview: string | null;
  last_sender_type: string | null;
  needs_reply: boolean;
  unread_for_support: boolean;
};

type InboundMessageRow = {
  id: string;
  thread_id: string;
  sender_user_id: string | null;
  body: string;
  created_at: string;
};

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const threadLimit = parseLimit(searchParams.get('threadLimit'), 10, 20);
    const inboundLimit = parseLimit(searchParams.get('inboundLimit'), 10, 20);

    const [threadsRes, unreadRes, needsReplyRes, openRes, inboundRes] = await Promise.all([
      auth.admin
        .from('support_threads')
        .select('id, user_id, status, last_message_at, created_at, last_message_preview, last_sender_type, needs_reply, unread_for_support')
        .order('last_message_at', { ascending: false })
        .limit(threadLimit),
      auth.admin
        .from('support_threads')
        .select('id', { count: 'exact', head: true })
        .eq('unread_for_support', true),
      auth.admin
        .from('support_threads')
        .select('id', { count: 'exact', head: true })
        .eq('needs_reply', true),
      auth.admin
        .from('support_threads')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'closed'),
      auth.admin
        .from('support_messages')
        .select('id, thread_id, sender_user_id, body, created_at')
        .eq('sender_type', 'user')
        .order('created_at', { ascending: false })
        .limit(inboundLimit),
    ]);

    if (threadsRes.error) {
      return NextResponse.json({ error: threadsRes.error.message }, { status: 500 });
    }
    if (inboundRes.error) {
      return NextResponse.json({ error: inboundRes.error.message }, { status: 500 });
    }

    const threadRows = (threadsRes.data ?? []) as SupportThreadRow[];
    const inboundRows = (inboundRes.data ?? []) as InboundMessageRow[];

    const profileIds = new Set<string>();
    threadRows.forEach((row) => {
      if (row.user_id) profileIds.add(row.user_id);
    });
    inboundRows.forEach((row) => {
      if (row.sender_user_id) profileIds.add(row.sender_user_id);
    });

    let profilesById = new Map<string, ProfileLite>();
    if (profileIds.size > 0) {
      const { data: profilesData, error: profilesError } = await auth.admin
        .from('profiles')
        .select('id, email, full_name')
        .in('id', Array.from(profileIds));

      if (!profilesError && profilesData) {
        profilesById = new Map(
          (profilesData as ProfileLite[]).map((profile) => [profile.id, profile])
        );
      }
    }

    return NextResponse.json({
      kpis: {
        unread: unreadRes.count ?? 0,
        needsReply: needsReplyRes.count ?? 0,
        openThreads: openRes.count ?? 0,
      },
      threads: threadRows.map((row) => {
        const profile = profilesById.get(row.user_id);
        return {
          id: row.id,
          userId: row.user_id,
          userEmail: profile?.email ?? null,
          userName: profile?.full_name ?? null,
          status: row.status ?? 'open',
          lastMessageAt: row.last_message_at ?? row.created_at,
          lastMessagePreview: row.last_message_preview ?? null,
          lastSenderType: row.last_sender_type ?? null,
          needsReply: !!row.needs_reply,
          unreadForSupport: !!row.unread_for_support,
        };
      }),
      latestInboundMessages: inboundRows.map((row) => {
        const profile = row.sender_user_id ? profilesById.get(row.sender_user_id) : null;
        return {
          id: row.id,
          threadId: row.thread_id,
          userId: row.sender_user_id,
          userEmail: profile?.email ?? null,
          userName: profile?.full_name ?? null,
          body: row.body,
          createdAt: row.created_at,
        };
      }),
    });
  } catch (error) {
    console.error('[api/admin/inbox/support] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
