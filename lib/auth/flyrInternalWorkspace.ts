import { notFound, redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminClient>;

function getFlyrInternalWorkspaceId(): string {
  const workspaceId = process.env.FLYR_INTERNAL_WORKSPACE_ID?.trim();
  if (!workspaceId) {
    throw new Error('FLYR_INTERNAL_WORKSPACE_ID is required for demo admin access.');
  }
  return workspaceId;
}

export async function isFlyrInternalWorkspaceMember(
  admin: AdminClient,
  userId: string
): Promise<boolean> {
  const workspaceId = getFlyrInternalWorkspaceId();
  const { data, error } = await admin
    .from('workspace_members')
    .select('id')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) {
    console.error('[flyr-internal-auth] Workspace membership lookup failed:', error);
    return false;
  }

  return Boolean(data?.id);
}

/**
 * Server-only guard for internal FLYR demo tooling.
 * Unauthenticated users go to login; authenticated non-members get a 404.
 */
export async function requireFlyrInternalWorkspaceMember(): Promise<{ user: User }> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/login');
  }

  const admin = createAdminClient();
  const allowed = await isFlyrInternalWorkspaceMember(admin, user.id);
  if (!allowed) {
    notFound();
  }

  return { user };
}
