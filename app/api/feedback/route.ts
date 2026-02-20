import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';

const MIN_MESSAGE_LENGTH = 5;
const MAX_MESSAGE_LENGTH = 3000;
const MAX_PAGE_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;
const ALLOWED_ROLES = new Set(['owner', 'admin', 'member']);

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as any,
      user.id,
      requestedWorkspaceId
    );
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }

    const userAgent = request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null;

    const { error: insertError } = await supabase.from('feedback_submissions').insert({
      workspace_id: workspaceResolution.workspaceId,
      user_id: user.id,
      email: user.email ?? null,
      role: role || null,
      page,
      message,
      user_agent: userAgent,
    });

    if (insertError) {
      console.error('Failed to save feedback submission:', insertError);
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Feedback API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
