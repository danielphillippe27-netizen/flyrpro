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

    if (threadsRes.error) {
      return NextResponse.json({ error: threadsRes.error.message }, { status: 500 });
    }
    if (itemsRes.error) {
      return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
    }

    const threadRows = (threadsRes.data ?? []) as FeedbackThreadRow[];
    const itemRows = (itemsRes.data ?? []) as FeedbackItemRow[];

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
        newFeedback: unreadRes.count ?? 0,
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
