import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

const DEFAULT_INVITE_TTL_DAYS = 30;
const DEFAULT_PUBLIC_JOIN_ORIGIN = 'https://www.flyrpro.app';
const PUBLIC_INVITE_EMAIL_DOMAIN = 'invite.flyr.invalid';

type CreateInviteBody = {
  campaignId?: string | null;
  sessionId?: string | null;
};

type CampaignRow = {
  id: string;
  title: string | null;
  workspace_id: string | null;
  owner_id: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  campaign_id: string | null;
  workspace_id: string | null;
  end_time: string | null;
};

type WorkspaceRow = {
  id: string;
  name: string | null;
  owner_id: string;
};

function makeInviteToken(): string {
  return randomBytes(24).toString('hex');
}

function makePublicInviteEmail(token: string): string {
  return `public-${token}@${PUBLIC_INVITE_EMAIL_DOMAIN}`;
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

function normalizedOrigin(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function buildInviteOrigin(request: NextRequest): string {
  const configuredOrigin =
    normalizedOrigin(process.env.FLYR_PUBLIC_JOIN_ORIGIN) ??
    normalizedOrigin(process.env.NEXT_PUBLIC_APP_URL);

  if (configuredOrigin) {
    const normalized = new URL(configuredOrigin);
    if (normalized.hostname.toLowerCase() === 'flyrpro.app') {
      normalized.hostname = 'www.flyrpro.app';
    }
    return normalized.origin;
  }

  const requestOrigin = request.nextUrl.origin;
  const requestHost = request.nextUrl.hostname.toLowerCase();
  if (requestHost === 'flyrpro.app') {
    return 'https://www.flyrpro.app';
  }
  if (requestHost === 'www.flyrpro.app') {
    return requestOrigin;
  }

  return DEFAULT_PUBLIC_JOIN_ORIGIN;
}

function buildInviteURL(request: NextRequest, token: string): string {
  const url = new URL('/join', buildInviteOrigin(request));
  url.searchParams.set('token', token);
  return url.toString();
}

function buildShareMessage(inviteURL: string, campaignTitle?: string | null): string {
  const trimmedTitle = campaignTitle?.trim();
  if (trimmedTitle) {
    return [
      "I'm live in FLYR right now.",
      `Open this link to join my live session in ${trimmedTitle}.`,
      inviteURL,
    ].join('\n\n');
  }

  return [
    "I'm live in FLYR right now.",
    'Open this link to join my live session.',
    inviteURL,
  ].join('\n\n');
}

function buildInviteTargetMessage(options: {
  campaignId?: string | null;
  sessionId?: string | null;
}): string {
  return JSON.stringify({
    kind: 'live_handoff',
    campaign_id: options.campaignId ?? null,
    session_id: options.sessionId ?? null,
  });
}

function isNullInviteEmailError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as {
    code?: string | null;
    message?: string | null;
    details?: string | null;
  };
  const haystack = [maybe.message, maybe.details]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

  return (
    maybe.code === '23502' &&
    haystack.includes('workspace_invites') &&
    haystack.includes('email')
  );
}

async function canUserAccessCampaign(
  admin: ReturnType<typeof createAdminClient>,
  campaign: CampaignRow,
  userId: string
): Promise<boolean> {
  if (campaign.owner_id === userId) {
    return true;
  }

  if (campaign.workspace_id) {
    const [{ data: workspace }, { data: workspaceMember }] = await Promise.all([
      admin
        .from('workspaces')
        .select('id, owner_id')
        .eq('id', campaign.workspace_id)
        .maybeSingle(),
      admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('workspace_id', campaign.workspace_id)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    if (workspace?.owner_id === userId || workspaceMember?.workspace_id) {
      return true;
    }
  }

  return false;
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as CreateInviteBody;
    const campaignId = body.campaignId?.trim() || null;
    const sessionId = body.sessionId?.trim() || null;

    if (!campaignId && !sessionId) {
      return NextResponse.json(
        { error: 'campaignId or sessionId is required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    let activeSession: SessionRow | null = null;
    if (sessionId) {
      const { data: sessionData, error: sessionError } = await admin
        .from('sessions')
        .select('id, user_id, campaign_id, workspace_id, end_time')
        .eq('id', sessionId)
        .maybeSingle();

      if (sessionError) {
        console.error('[invites/create] session lookup error:', sessionError);
        return NextResponse.json(
          { error: 'Unable to load active session' },
          { status: 500 }
        );
      }

      activeSession = (sessionData as SessionRow | null) ?? null;
      if (!activeSession) {
        return NextResponse.json(
          { error: 'Active session not found' },
          { status: 404 }
        );
      }

      if (activeSession.user_id !== requestUser.id) {
        return NextResponse.json(
          { error: 'You can only share invite links for your own active session.' },
          { status: 403 }
        );
      }

      if (activeSession.end_time) {
        return NextResponse.json(
          { error: 'This live session has already ended. Start a new session before inviting teammates.' },
          { status: 400 }
        );
      }
    }

    if (campaignId && activeSession?.campaign_id && campaignId !== activeSession.campaign_id) {
      return NextResponse.json(
        { error: 'This live session is attached to a different campaign.' },
        { status: 400 }
      );
    }

    const resolvedCampaignId = campaignId ?? activeSession?.campaign_id ?? null;
    if (!resolvedCampaignId) {
      return NextResponse.json(
        { error: 'This live session is not attached to a campaign yet.' },
        { status: 400 }
      );
    }

    const { data: campaignData, error: campaignError } = await admin
      .from('campaigns')
      .select('id, title, workspace_id, owner_id')
      .eq('id', resolvedCampaignId)
      .maybeSingle();

    if (campaignError) {
      console.error('[invites/create] campaign lookup error:', campaignError);
      return NextResponse.json(
        { error: 'Unable to load campaign' },
        { status: 500 }
      );
    }

    const campaign = (campaignData as CampaignRow | null) ?? null;
    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found for this live session.' },
        { status: 404 }
      );
    }

    const hasAccess = await canUserAccessCampaign(admin, campaign, requestUser.id);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'You do not have access to invite people to this campaign.' },
        { status: 403 }
      );
    }

    const workspaceId = campaign.workspace_id ?? activeSession?.workspace_id ?? null;
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Campaign invites require a workspace-backed campaign.' },
        { status: 400 }
      );
    }

    const { data: workspaceData, error: workspaceError } = await admin
      .from('workspaces')
      .select('id, name, owner_id')
      .eq('id', workspaceId)
      .maybeSingle();

    if (workspaceError) {
      console.error('[invites/create] workspace lookup error:', workspaceError);
      return NextResponse.json(
        { error: 'Unable to load workspace' },
        { status: 500 }
      );
    }

    const workspace = (workspaceData as WorkspaceRow | null) ?? null;
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const inviteToken = makeInviteToken();
    const expiresAt = new Date(
      Date.now() + DEFAULT_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    let storedCampaignId = campaign.id;
    let storedSessionId = activeSession?.id ?? null;
    const fallbackTargetMessage = buildInviteTargetMessage({
      campaignId: campaign.id,
      sessionId: activeSession?.id ?? null,
    });
    let inviteInsert: Record<string, string | null> = {
      workspace_id: workspace.id,
      campaign_id: campaign.id,
      session_id: activeSession?.id ?? null,
      invited_by: requestUser.id,
      email: null,
      role: 'member',
      token: inviteToken,
      status: 'pending',
      expires_at: expiresAt,
    };

    const appliedFallbacks = new Set<string>();
    let insertResult = await admin.from('workspace_invites').insert(inviteInsert);

    while (insertResult.error) {
      if (
        !appliedFallbacks.has('public-email') &&
        isNullInviteEmailError(insertResult.error)
      ) {
        inviteInsert = {
          ...inviteInsert,
          email: makePublicInviteEmail(inviteToken),
        };
        appliedFallbacks.add('public-email');
        insertResult = await admin.from('workspace_invites').insert(inviteInsert);
        continue;
      }

      if (
        !appliedFallbacks.has('session_id') &&
        isMissingColumnError(insertResult.error, 'session_id')
      ) {
        storedSessionId = null;
        const { session_id: _sessionId, ...withoutSessionId } = inviteInsert;
        inviteInsert = {
          ...withoutSessionId,
          message: fallbackTargetMessage,
        };
        appliedFallbacks.add('session_id');
        insertResult = await admin.from('workspace_invites').insert(inviteInsert);
        continue;
      }

      if (
        !appliedFallbacks.has('campaign_id') &&
        isMissingColumnError(insertResult.error, 'campaign_id')
      ) {
        storedCampaignId = null;
        const { campaign_id: _campaignId, ...withoutCampaignId } = inviteInsert;
        inviteInsert = {
          ...withoutCampaignId,
          message: fallbackTargetMessage,
        };
        appliedFallbacks.add('campaign_id');
        insertResult = await admin.from('workspace_invites').insert(inviteInsert);
        continue;
      }

      if (
        !appliedFallbacks.has('message') &&
        isMissingColumnError(insertResult.error, 'message')
      ) {
        const { message: _message, ...withoutMessage } = inviteInsert;
        inviteInsert = withoutMessage;
        appliedFallbacks.add('message');
        insertResult = await admin.from('workspace_invites').insert(inviteInsert);
        continue;
      }

      break;
    }

    if (insertResult.error) {
      console.error('[invites/create] insert error:', insertResult.error);
      return NextResponse.json(
        { error: 'Unable to create invite link' },
        { status: 500 }
      );
    }

    const inviteURL = buildInviteURL(request, inviteToken);
    const shareMessage = buildShareMessage(inviteURL, campaign.title);

    return NextResponse.json({
      success: true,
      invite_url: inviteURL,
      inviteUrl: inviteURL,
      share_message: shareMessage,
      shareMessage,
      workspace_id: workspace.id,
      workspaceId: workspace.id,
      workspace_name: workspace.name,
      workspaceName: workspace.name,
      campaign_id: storedCampaignId,
      campaignId: storedCampaignId,
      campaign_title: campaign.title,
      campaignTitle: campaign.title,
      session_id: storedSessionId,
      sessionId: storedSessionId,
      role: 'member',
      expires_at: expiresAt,
      expiresAt,
    });
  } catch (error) {
    console.error('[invites/create]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
