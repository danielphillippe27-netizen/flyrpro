import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveInviteTarget } from '@/app/api/invites/_lib/targets';

type InviteRow = {
  id: string;
  workspace_id: string;
  email: string | null;
  role: string;
  access_scope?: string | null;
  status?: string | null;
  expires_at: string | null;
  accepted_at?: string | null;
};

type InviteAccessScope = 'workspace' | 'campaign';

function normalizeInviteEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.endsWith('@invite.flyr.invalid')) {
    return null;
  }
  return normalized.length > 0 ? normalized : null;
}

async function getInviteByToken(
  admin: ReturnType<typeof createAdminClient>,
  token: string
): Promise<{ invite: InviteRow | null; error: unknown }> {
  const primaryColumns =
    'id, workspace_id, email, role, access_scope, status, expires_at, accepted_at';
  const fallbackColumns =
    'id, workspace_id, email, role, status, expires_at, accepted_at';
  const candidates: Array<'token' | 'invite_token'> = ['token', 'invite_token'];

  for (const candidate of candidates) {
    const result = await admin
      .from('workspace_invites')
      .select(primaryColumns)
      .eq(candidate, token)
      .maybeSingle();

    if (!result.error) {
      return {
        invite: (result.data as InviteRow | null) ?? null,
        error: null,
      };
    }

    const maybeError = result.error as { code?: string; message?: string } | null;
    const missingAccessScopeColumn =
      maybeError?.code === '42703' &&
      typeof maybeError.message === 'string' &&
      maybeError.message.includes('access_scope');

    if (!missingAccessScopeColumn) {
      continue;
    }

    const fallback = await admin
      .from('workspace_invites')
      .select(fallbackColumns)
      .eq(candidate, token)
      .maybeSingle();

    if (!fallback.error) {
      return {
        invite: fallback.data
          ? ({ ...fallback.data, access_scope: null } as InviteRow)
          : null,
        error: null,
      };
    }
  }

  return { invite: null, error: null };
}

function normalizeInviteAccessScope(
  value: string | null | undefined,
  fallback: {
    campaignId: string | null;
    sessionId: string | null;
  }
): InviteAccessScope {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'workspace') return 'workspace';
  if (normalized === 'campaign') return 'campaign';
  return fallback.campaignId || fallback.sessionId ? 'campaign' : 'workspace';
}

/**
 * GET /api/invites/validate?token=...
 * Returns invite details if token is valid and pending. Does not require auth.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token?.trim()) {
    return NextResponse.json(
      { error: 'Token required' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { invite, error } = await getInviteByToken(admin, token.trim());

  if (error || !invite) {
    return NextResponse.json(
      { error: 'Invalid or expired invite' },
      { status: 404 }
    );
  }

  const inviteStatus = invite.status ?? (invite.accepted_at ? 'accepted' : 'pending');
  if (inviteStatus === 'expired') {
    return NextResponse.json(
      { error: 'This invite has expired' },
      { status: 400 }
    );
  }

  const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null;
  if (expiresAt && expiresAt <= new Date()) {
    return NextResponse.json(
      { error: 'This invite has expired' },
      { status: 400 }
    );
  }

  const [{ data: workspace }, target] = await Promise.all([
    admin
      .from('workspaces')
      .select('id, name')
      .eq('id', invite.workspace_id)
      .single(),
    resolveInviteTarget(admin, invite.id),
  ]);

  const campaign = target.campaignId
    ? await admin
        .from('campaigns')
        .select('id, title')
        .eq('id', target.campaignId)
        .maybeSingle()
    : { data: null };

  const workspaceName = workspace?.name ?? null;
  const campaignTitle = campaign.data?.title ?? null;
  const accessScope = normalizeInviteAccessScope(invite.access_scope, target);
  const response = {
    valid: true,
    alreadyAccepted: inviteStatus === 'accepted',
    already_accepted: inviteStatus === 'accepted',
    workspaceName,
    workspace_name: workspaceName,
    campaignId: target.campaignId,
    campaign_id: target.campaignId,
    campaignTitle,
    campaign_title: campaignTitle,
    sessionId: target.sessionId,
    session_id: target.sessionId,
    accessScope,
    access_scope: accessScope,
    email: normalizeInviteEmail(invite.email),
    role: invite.role,
  };

  return NextResponse.json(response);
}
