import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

export type PostAuthRedirect =
  | { redirect: 'login'; path: '/login' }
  | { redirect: 'join'; path: string }
  | { redirect: 'onboarding'; path: '/onboarding' }
  | { redirect: 'subscribe'; path: '/subscribe' }
  | { redirect: 'contact-owner'; path: '/subscribe?reason=member-inactive' }
  | { redirect: 'dashboard'; path: string };

export type GateOptions = {
  /** If set, user came from invite link; after auth they should accept then go to dashboard */
  inviteToken?: string | null;
  /** Optional next path after gate (e.g. /home or /campaigns) */
  next?: string | null;
};

/**
 * Server-side gate: determines where to send the user after auth.
 * Use in Route Handler (GET /gate) or server component.
 */
export async function getPostAuthRedirect(options: GateOptions = {}): Promise<PostAuthRedirect> {
  const { inviteToken, next } = options;
  const authClient = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return { redirect: 'login', path: '/login' };
  }

  const userId = user.id;

  // Invite flow: send to join page to accept invite (token preserved in URL)
  if (inviteToken && inviteToken.trim()) {
    return { redirect: 'join', path: `/join?token=${encodeURIComponent(inviteToken.trim())}` };
  }

  const admin = createAdminClient();
  const access = await resolveDashboardAccessLevel(
    admin as unknown as MinimalSupabaseClient,
    userId
  );
  const founderPath = next && next !== '/home' ? next : '/admin';
  if (!access.workspaceId) {
    if (access.isFounder) {
      return { redirect: 'dashboard', path: founderPath };
    }
    return { redirect: 'onboarding', path: '/onboarding' };
  }

  // Workspace row (name, subscription_status, onboarding_completed_at)
  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .select('id, subscription_status, trial_ends_at, onboarding_completed_at')
    .eq('id', access.workspaceId)
    .single();

  if (wsError || !workspace) {
    if (access.isFounder) {
      return { redirect: 'dashboard', path: founderPath };
    }
    return { redirect: 'dashboard', path: next || '/home' };
  }

  const subscriptionStatus = workspace.subscription_status ?? 'inactive';
  const trialEndsAt = workspace.trial_ends_at ? new Date(workspace.trial_ends_at) : null;
  const hasDashboardAccess =
    subscriptionStatus === 'active' ||
    (subscriptionStatus === 'trialing' && (!trialEndsAt || trialEndsAt > new Date()));
  const effectiveAccess = hasDashboardAccess || access.isFounder;

  if (access.level === 'founder') {
    return { redirect: 'dashboard', path: founderPath };
  }

  if (access.level === 'member') {
    if (!effectiveAccess) {
      return { redirect: 'contact-owner', path: '/subscribe?reason=member-inactive' };
    }
    return { redirect: 'dashboard', path: next || '/home' };
  }

  if ((access.level === 'solo_owner' || access.level === 'team_leader') && !effectiveAccess) {
    return { redirect: 'subscribe', path: '/subscribe' };
  }

  return { redirect: 'dashboard', path: next || '/home' };
}
