import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

const MIN_MESSAGE_LENGTH = 5;
const MAX_MESSAGE_LENGTH = 3000;
const MAX_PAGE_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;
const ALLOWED_ROLES = new Set(['owner', 'admin', 'member']);

function isMissingRelationError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('could not find the table') ||
    normalized.includes('relation') && normalized.includes('does not exist')
  );
}

export async function POST(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    const payload = await request.json().catch(() => null) as {
      message?: unknown;
      workspaceId?: unknown;
      role?: unknown;
      page?: unknown;
    } | null;

    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    if (message.length < MIN_MESSAGE_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Message must be ${MIN_MESSAGE_LENGTH}-${MAX_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const requestedWorkspaceId = typeof payload?.workspaceId === 'string'
      ? payload.workspaceId
      : null;
    const page = typeof payload?.page === 'string'
      ? payload.page.trim().slice(0, MAX_PAGE_LENGTH)
      : null;
    const rawRole = typeof payload?.role === 'string'
      ? payload.role.trim().toLowerCase()
      : null;
    const role = rawRole && ALLOWED_ROLES.has(rawRole) ? rawRole : null;

    let workspaceId: string | null = null;
    const workspaceResolution = await resolveWorkspaceIdForUser(
      admin as unknown as MinimalSupabaseClient,
      user.id,
      requestedWorkspaceId
    );
    if (workspaceResolution.workspaceId) {
      workspaceId = workspaceResolution.workspaceId;
    }

    if (!workspaceId && requestedWorkspaceId) {
      const { data: founderRow } = await admin
        .from('user_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('is_founder', true)
        .maybeSingle();
      if (founderRow?.user_id) {
        const { data: workspaceRow } = await admin
          .from('workspaces')
          .select('id')
          .eq('id', requestedWorkspaceId)
          .maybeSingle();
        workspaceId = workspaceRow?.id ?? null;
      }
    }

    if (!workspaceId) {
      const { data: fallback } = await admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      workspaceId = fallback?.workspace_id ?? null;
    }

    if (!workspaceId) {
      const { data: fallbackOwnedWorkspace } = await admin
        .from('workspaces')
        .select('id')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      workspaceId = fallbackOwnedWorkspace?.id ?? null;
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'No workspace membership found for this user' },
        { status: workspaceResolution.status ?? 400 }
      );
    }

    const [{ data: membership }, { data: founderProfile }] = await Promise.all([
      admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .maybeSingle(),
      admin
        .from('user_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('is_founder', true)
        .maybeSingle(),
    ]);

    if (!membership?.workspace_id && !founderProfile?.user_id) {
      return NextResponse.json(
        { error: 'You do not have access to submit feedback for this workspace.' },
        { status: 403 }
      );
    }

    const userAgent = request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null;

    let threadId: string | null = null;
    const { data: existingThread, error: existingThreadError } = await admin
      .from('feedback_threads')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('last_feedback_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingThreadError && !isMissingRelationError(existingThreadError.message)) {
      console.error('Failed to load feedback thread:', existingThreadError);
      return NextResponse.json(
        { error: existingThreadError.message || 'Failed to save feedback' },
        { status: 500 }
      );
    }
    threadId = existingThread?.id ?? null;

    if (!threadId) {
      const { data: createdThread, error: createThreadError } = await admin
        .from('feedback_threads')
        .insert({ user_id: user.id, status: 'open' })
        .select('id')
        .single();
      if (createThreadError) {
        console.error('Failed to create feedback thread:', createThreadError);
        return NextResponse.json(
          { error: createThreadError.message || 'Failed to save feedback' },
          { status: 500 }
        );
      }
      threadId = createdThread?.id ?? null;
    }

    if (!threadId) {
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
    }

    const { error: itemError } = await admin.from('feedback_items').insert({
      thread_id: threadId,
      user_id: user.id,
      type: 'other',
      body: message,
      context: {
        source: 'web',
        workspace_id: workspaceId,
        email: user.email ?? null,
        role: role || null,
        page,
        user_agent: userAgent,
      },
    });
    if (itemError) {
      console.error('Failed to save feedback item:', itemError);
      return NextResponse.json(
        { error: itemError.message || 'Failed to save feedback' },
        { status: 500 }
      );
    }

    const { error: legacyInsertError } = await admin.from('feedback_submissions').insert({
      workspace_id: workspaceId,
      user_id: user.id,
      email: user.email ?? null,
      role: role || null,
      page,
      message,
      user_agent: userAgent,
    });

    if (legacyInsertError && !isMissingRelationError(legacyInsertError.message)) {
      console.error('Failed to mirror feedback submission:', legacyInsertError);
      return NextResponse.json(
        { error: legacyInsertError.message || 'Failed to save feedback' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Feedback API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
