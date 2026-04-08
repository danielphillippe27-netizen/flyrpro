import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

type ProfileLite = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type FeedbackThreadRow = {
  id: string;
  user_id: string;
  status: string;
  last_feedback_at: string;
  unread_for_founder: boolean;
  created_at: string;
};

type FeedbackItemRow = {
  id: string;
  thread_id: string;
  user_id: string;
  type: 'bug' | 'feature' | 'other';
  title: string | null;
  body: string;
  context: Record<string, unknown> | null;
  created_at: string;
};

type LegacyFeedbackSubmissionRow = {
  id: string;
  user_id: string;
  email: string | null;
  role: string | null;
  page: string | null;
  message: string;
  user_agent: string | null;
  created_at: string;
};

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function isMissingRelationError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('could not find the table') ||
    (normalized.includes('relation') && normalized.includes('does not exist'))
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const itemLimit = parseLimit(searchParams.get('itemLimit'), 10, 100);
    const threadLimit = parseLimit(searchParams.get('threadLimit'), 10, 100);
    const threadId = searchParams.get('thread');

    const threadQuery = auth.admin
      .from('feedback_threads')
      .select('id, user_id, status, last_feedback_at, unread_for_founder, created_at')
      .order('last_feedback_at', { ascending: false })
      .limit(threadLimit);

    const itemsQuery = auth.admin
      .from('feedback_items')
      .select('id, thread_id, user_id, type, title, body, context, created_at')
      .order('created_at', { ascending: false })
      .limit(itemLimit);

    const [threadsRes, unreadRes, itemsRes] = await Promise.all([
      threadQuery,
      auth.admin
        .from('feedback_threads')
        .select('id', { count: 'exact', head: true })
        .eq('unread_for_founder', true),
      threadId ? itemsQuery.eq('thread_id', threadId) : itemsQuery,
    ]);

    if (threadsRes.error && !isMissingRelationError(threadsRes.error.message)) {
      return NextResponse.json({ error: threadsRes.error.message }, { status: 500 });
    }
    if (itemsRes.error && !isMissingRelationError(itemsRes.error.message)) {
      return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
    }

    let threadRows = (threadsRes.data ?? []) as FeedbackThreadRow[];
    let itemRows = (itemsRes.data ?? []) as FeedbackItemRow[];

    // Backward-compatible fallback: if no new feedback rows are present yet,
    // read from the legacy feedback_submissions table so founder inbox still receives web feedback.
    if (itemRows.length === 0) {
      const legacyBase = auth.admin
        .from('feedback_submissions')
        .select('id, user_id, email, role, page, message, user_agent, created_at')
        .order('created_at', { ascending: false })
        .limit(itemLimit);
      const legacyThreadUserId =
        threadId && threadId.startsWith('legacy-') ? threadId.slice('legacy-'.length) : null;
      const { data: legacyData, error: legacyError } = legacyThreadUserId
        ? await legacyBase.eq('user_id', legacyThreadUserId)
        : await legacyBase;

      if (legacyError && !isMissingRelationError(legacyError.message)) {
        return NextResponse.json({ error: legacyError.message }, { status: 500 });
      }

      const legacyRows = (legacyData ?? []) as LegacyFeedbackSubmissionRow[];
      if (legacyRows.length > 0) {
        itemRows = legacyRows.map((row) => ({
          id: row.id,
          thread_id: `legacy-${row.user_id}`,
          user_id: row.user_id,
          type: 'other',
          title: null,
          body: row.message,
          context: {
            source: 'web',
            page: row.page,
            role: row.role,
            user_agent: row.user_agent,
            email: row.email,
            legacy_submission: true,
          },
          created_at: row.created_at,
        }));

        const byUser = new Map<string, { createdAt: string }>();
        legacyRows.forEach((row) => {
          const existing = byUser.get(row.user_id);
          if (!existing || new Date(row.created_at).getTime() > new Date(existing.createdAt).getTime()) {
            byUser.set(row.user_id, { createdAt: row.created_at });
          }
        });

        threadRows = Array.from(byUser.entries())
          .map(([userId, meta]) => ({
            id: `legacy-${userId}`,
            user_id: userId,
            status: 'open',
            last_feedback_at: meta.createdAt,
            unread_for_founder: false,
            created_at: meta.createdAt,
          }))
          .sort(
            (a, b) =>
              new Date(b.last_feedback_at).getTime() - new Date(a.last_feedback_at).getTime()
          )
          .slice(0, threadLimit);
      }
    }

    const profileIds = new Set<string>();
    threadRows.forEach((row) => {
      if (row.user_id) profileIds.add(row.user_id);
    });
    itemRows.forEach((row) => {
      if (row.user_id) profileIds.add(row.user_id);
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
        newFeedback: unreadRes.count ?? (itemRows.length > 0 ? itemRows.length : 0),
      },
      threads: threadRows.map((row) => {
        const profile = profilesById.get(row.user_id);
        return {
          id: row.id,
          userId: row.user_id,
          userEmail: profile?.email ?? null,
          userName: profile?.full_name ?? null,
          status: row.status,
          lastFeedbackAt: row.last_feedback_at,
          unreadForFounder: !!row.unread_for_founder,
          createdAt: row.created_at,
        };
      }),
      items: itemRows.map((row) => {
        const profile = profilesById.get(row.user_id);
        const context = row.context ?? {};
        return {
          id: row.id,
          threadId: row.thread_id,
          userId: row.user_id,
          userEmail: profile?.email ?? null,
          userName: profile?.full_name ?? null,
          type: row.type,
          title: row.title,
          body: row.body,
          createdAt: row.created_at,
          context,
          appVersion: typeof context.app_version === 'string' ? context.app_version : null,
          buildNumber: typeof context.build_number === 'string' ? context.build_number : null,
          iosVersion: typeof context.ios_version === 'string' ? context.ios_version : null,
          deviceModel: typeof context.device_model === 'string' ? context.device_model : null,
          screenName: typeof context.screen_name === 'string' ? context.screen_name : null,
          screenshotUrl: typeof context.screenshot_url === 'string' ? context.screenshot_url : null,
        };
      }),
    });
  } catch (error) {
    console.error('[api/admin/inbox/feedback] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
