import { createAdminClient } from '@/lib/supabase/server';

type InviteTargetRow = {
  campaign_id?: string | null;
  session_id?: string | null;
};

type SessionTargetRow = {
  id: string;
  end_time: string | null;
  campaign_id: string | null;
};

function parseInviteTargetMessage(value: unknown): Required<InviteTargetRow> {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) {
    return { campaign_id: null, session_id: null };
  }

  try {
    const parsed = JSON.parse(value) as {
      campaign_id?: unknown;
      session_id?: unknown;
    };

    return {
      campaign_id: typeof parsed.campaign_id === 'string' ? parsed.campaign_id : null,
      session_id: typeof parsed.session_id === 'string' ? parsed.session_id : null,
    };
  } catch {
    return { campaign_id: null, session_id: null };
  }
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as {
    message?: string | null;
    details?: string | null;
    hint?: string | null;
  };
  const haystack = [maybe.message, maybe.details, maybe.hint]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

  return (
    haystack.includes(columnName.toLowerCase()) &&
    (haystack.includes('column') ||
      haystack.includes('schema cache') ||
      haystack.includes('does not exist'))
  );
}

export async function getInviteTargetsById(
  admin: ReturnType<typeof createAdminClient>,
  inviteId: string
): Promise<Required<InviteTargetRow>> {
  const fallbackMessage = await admin
    .from('workspace_invites')
    .select('message')
    .eq('id', inviteId)
    .maybeSingle();

  const messageTargets = fallbackMessage.error
    ? { campaign_id: null, session_id: null }
    : parseInviteTargetMessage(fallbackMessage.data?.message);

  if (fallbackMessage.error && !isMissingColumnError(fallbackMessage.error, 'message')) {
    console.warn('[invites] failed to load invite target fallback message', fallbackMessage.error);
  }

  const withTargets = await admin
    .from('workspace_invites')
    .select('campaign_id, session_id')
    .eq('id', inviteId)
    .maybeSingle();

  if (!withTargets.error) {
    return {
      campaign_id: withTargets.data?.campaign_id ?? messageTargets.campaign_id ?? null,
      session_id: withTargets.data?.session_id ?? messageTargets.session_id ?? null,
    };
  }

  const referencesCampaignId = isMissingColumnError(withTargets.error, 'campaign_id');
  const referencesSessionId = isMissingColumnError(withTargets.error, 'session_id');

  if (!referencesCampaignId && !referencesSessionId) {
    console.warn('[invites] failed to load invite target columns', withTargets.error);
    return messageTargets;
  }

  let campaignId: string | null = null;
  let sessionId: string | null = null;

  if (!referencesCampaignId) {
    const campaignOnly = await admin
      .from('workspace_invites')
      .select('campaign_id')
      .eq('id', inviteId)
      .maybeSingle();

    if (!campaignOnly.error) {
      campaignId = campaignOnly.data?.campaign_id ?? null;
    } else if (!isMissingColumnError(campaignOnly.error, 'campaign_id')) {
      console.warn('[invites] failed to load invite campaign target', campaignOnly.error);
    }
  }

  if (!referencesSessionId) {
    const sessionOnly = await admin
      .from('workspace_invites')
      .select('session_id')
      .eq('id', inviteId)
      .maybeSingle();

    if (!sessionOnly.error) {
      sessionId = sessionOnly.data?.session_id ?? null;
    } else if (!isMissingColumnError(sessionOnly.error, 'session_id')) {
      console.warn('[invites] failed to load invite live session target', sessionOnly.error);
    }
  }

  return {
    campaign_id: campaignId ?? messageTargets.campaign_id ?? null,
    session_id: sessionId ?? messageTargets.session_id ?? null,
  };
}

export async function resolveInviteTarget(
  admin: ReturnType<typeof createAdminClient>,
  inviteId: string
): Promise<{ campaignId: string | null; sessionId: string | null }> {
  const targets = await getInviteTargetsById(admin, inviteId);

  if (!targets.session_id) {
    return {
      campaignId: targets.campaign_id ?? null,
      sessionId: null,
    };
  }

  const { data: sessionData, error: sessionError } = await admin
    .from('sessions')
    .select('id, end_time, campaign_id')
    .eq('id', targets.session_id)
    .maybeSingle();

  if (sessionError) {
    console.warn('[invites] failed to resolve invite session target', sessionError);
    return {
      campaignId: targets.campaign_id ?? null,
      sessionId: null,
    };
  }

  const session = (sessionData as SessionTargetRow | null) ?? null;

  return {
    campaignId: targets.campaign_id ?? session?.campaign_id ?? null,
    sessionId: session?.id && !session.end_time ? session.id : null,
  };
}

export function buildInviteRedirectPath(options: {
  campaignId?: string | null;
  sessionId?: string | null;
}): string {
  const campaignId = options.campaignId?.trim() ?? '';
  if (!campaignId) {
    return '/home';
  }

  const redirectURL = new URL(`/campaigns/${campaignId}`, 'https://wolfgrid.app');
  const sessionId = options.sessionId?.trim() ?? '';
  if (sessionId) {
    redirectURL.searchParams.set('session_id', sessionId);
  }

  return `${redirectURL.pathname}${redirectURL.search}`;
}
