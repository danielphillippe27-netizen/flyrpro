import { getSupabaseServerClient } from '@/lib/supabase/server';

export type PostAuthRedirect =
  | { redirect: 'login'; path: '/login' }
  | { redirect: 'join'; path: string }
  | { redirect: 'onboarding'; path: '/onboarding' }
  | { redirect: 'subscribe'; path: '/subscribe' }
  | { redirect: 'contact-owner'; path: '/subscribe?reason=member-inactive' }
  | { redirect: 'dashboard'; path: '/home' };

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
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { redirect: 'login', path: '/login' };
  }

  const userId = user.id;

  // Invite flow: send to join page to accept invite (token preserved in URL)
  if (inviteToken && inviteToken.trim()) {
    return { redirect: 'join', path: `/join?token=${encodeURIComponent(inviteToken.trim())}` };
  }

  // Primary workspace + role
  const { data: memberships, error: memError } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (memError || !memberships?.length) {
    // No workspace yet (shouldn't happen with trigger, but handle)
    return { redirect: 'onboarding', path: '/onboarding' };
  }

  const primary = memberships[0];
  const workspaceId = primary.workspace_id;
  const role = primary.role as 'owner' | 'admin' | 'member';

  // Workspace row (name, subscription_status, onboarding_completed_at)
  const { data: workspace, error: wsError } = await supabase
    .from('workspaces')
    .select('id, subscription_status, trial_ends_at, onboarding_completed_at')
    .eq('id', workspaceId)
    .single();

  if (wsError || !workspace) {
    return { redirect: 'dashboard', path: next || '/home' };
  }

  const subscriptionStatus = workspace.subscription_status ?? 'inactive';
  const trialEndsAt = workspace.trial_ends_at ? new Date(workspace.trial_ends_at) : null;
  const hasDashboardAccess =
    subscriptionStatus === 'active' ||
    (subscriptionStatus === 'trialing' && (!trialEndsAt || trialEndsAt > new Date()));

  const onboardingCompleted = !!workspace.onboarding_completed_at;

  // Owner: must complete onboarding first
  if (role === 'owner' && !onboardingCompleted) {
    return { redirect: 'onboarding', path: '/onboarding' };
  }

  // Member/Admin: workspace must be active; otherwise show contact-owner
  if (role === 'member' || role === 'admin') {
    if (!hasDashboardAccess) {
      return { redirect: 'contact-owner', path: '/subscribe?reason=member-inactive' };
    }
    return { redirect: 'dashboard', path: next || '/home' };
  }

  // Owner: check paywall
  if (role === 'owner' && !hasDashboardAccess) {
    return { redirect: 'subscribe', path: '/subscribe' };
  }

  return { redirect: 'dashboard', path: next || '/home' };
}
