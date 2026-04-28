import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  buildInviteRedirectPath,
  resolveInviteTarget,
} from '@/app/api/invites/_lib/targets';

type InviteRow = {
  id: string;
  workspace_id: string;
  email: string | null;
  role: 'admin' | 'member';
  access_scope?: string | null;
  status?: string | null;
  expires_at: string | null;
  accepted_at?: string | null;
  accepted_by_user_id?: string | null;
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

function inviteAcceptedResponse(options: {
  workspaceId: string;
  campaignId?: string | null;
  sessionId?: string | null;
  accessScope: InviteAccessScope;
  alreadyAccepted: boolean;
}) {
  const redirect = buildInviteRedirectPath({
    campaignId: options.campaignId,
    sessionId: options.sessionId,
  });

  return NextResponse.json({
    success: true,
    alreadyAccepted: options.alreadyAccepted,
    already_accepted: options.alreadyAccepted,
    workspaceId: options.workspaceId,
    workspace_id: options.workspaceId,
    campaignId: options.campaignId ?? null,
    campaign_id: options.campaignId ?? null,
    sessionId: options.sessionId ?? null,
    session_id: options.sessionId ?? null,
    accessScope: options.accessScope,
    access_scope: options.accessScope,
    redirect,
  });
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

function isLegacyAcceptedTriggerNullUserError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { code?: string; message?: string };
  return (
    maybe.code === '23502' &&
    typeof maybe.message === 'string' &&
    maybe.message.includes('null value in column "user_id" of relation "workspace_members"')
  );
}

async function getInviteByToken(
  admin: ReturnType<typeof createAdminClient>,
  token: string
): Promise<{ invite: InviteRow | null; error: unknown }> {
  const candidates: Array<'token' | 'invite_token'> = ['token', 'invite_token'];

  for (const candidate of candidates) {
    const withAcceptedBy = await admin
      .from('workspace_invites')
      .select('id, workspace_id, email, role, access_scope, status, expires_at, accepted_at, accepted_by_user_id')
      .eq(candidate, token)
      .maybeSingle();

    if (!withAcceptedBy.error) {
      return {
        invite: (withAcceptedBy.data as InviteRow | null) ?? null,
        error: null,
      };
    }

    const maybeError = withAcceptedBy.error as { code?: string; message?: string } | null;
    const missingAcceptedByColumn =
      maybeError?.code === '42703' &&
      typeof maybeError.message === 'string' &&
      maybeError.message.includes('accepted_by_user_id');
    const missingAccessScopeColumn =
      maybeError?.code === '42703' &&
      typeof maybeError.message === 'string' &&
      maybeError.message.includes('access_scope');

    if (!missingAcceptedByColumn && !missingAccessScopeColumn) {
      continue;
    }

    const fallback = await admin
      .from('workspace_invites')
      .select('id, workspace_id, email, role, status, expires_at, accepted_at')
      .eq(candidate, token)
      .maybeSingle();

    if (!fallback.error) {
      return {
        invite: fallback.data
          ? ({ ...fallback.data, access_scope: null, accepted_by_user_id: null } as InviteRow)
          : null,
        error: null,
      };
    }
  }

  return { invite: null, error: null };
}

async function markInviteAccepted(
  admin: ReturnType<typeof createAdminClient>,
  inviteId: string,
  userId: string,
  nowIso: string
) {
  const withAcceptedBy = await admin
    .from('workspace_invites')
    .update({
      status: 'accepted',
      accepted_at: nowIso,
      accepted_by_user_id: userId,
      updated_at: nowIso,
    })
    .eq('id', inviteId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (!withAcceptedBy.error) {
    return withAcceptedBy;
  }

  const maybeError = withAcceptedBy.error as { code?: string; message?: string } | null;
  const missingAcceptedByColumn =
    maybeError?.code === 'PGRST204' &&
    typeof maybeError.message === 'string' &&
    maybeError.message.includes('accepted_by_user_id');

  if (!missingAcceptedByColumn) {
    return withAcceptedBy;
  }

  return admin
    .from('workspace_invites')
    .update({
      status: 'accepted',
      accepted_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', inviteId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
}

async function ensureMembership(
  admin: ReturnType<typeof createAdminClient>,
  invite: InviteRow,
  userId: string,
  nowIso: string
) {
  return admin
    .from('workspace_members')
    .upsert(
      {
        workspace_id: invite.workspace_id,
        user_id: userId,
        role: invite.role,
        updated_at: nowIso,
      },
      { onConflict: 'workspace_id,user_id' }
    );
}

async function ensureCampaignMembership(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string,
  invite: InviteRow,
  userId: string
) {
  return admin
    .from('campaign_members')
    .upsert(
      {
        campaign_id: campaignId,
        user_id: userId,
        role: invite.role,
      },
      { onConflict: 'campaign_id,user_id' }
    );
}

/**
 * POST /api/invites/accept
 * Body: { token: string }
 * Current user must be logged in; their email must match the invite.
 * Safe to retry for the same user/token pair.
 */
export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userEmail = normalizeInviteEmail(requestUser.email) ?? '';

    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token.trim() : null;
    const firstName =
      typeof body?.firstName === 'string' ? body.firstName.trim() : '';
    const lastName =
      typeof body?.lastName === 'string' ? body.lastName.trim() : '';
    if (!token) {
      return NextResponse.json(
        { error: 'Token required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { invite, error: inviteError } = await getInviteByToken(admin, token);

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: 'Invalid or expired invite' },
        { status: 404 }
      );
    }

    const inviteTarget = await resolveInviteTarget(admin, invite.id);
    const accessScope = normalizeInviteAccessScope(invite.access_scope, inviteTarget);

    const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null;
    if (expiresAt && expiresAt <= new Date()) {
      return NextResponse.json(
        { error: 'This invite has expired' },
        { status: 400 }
      );
    }

    const inviteEmail = normalizeInviteEmail(invite.email);
    if (inviteEmail && userEmail !== inviteEmail) {
      return NextResponse.json(
        { error: 'This invite was sent to a different email address' },
        { status: 403 }
      );
    }

    const nowIso = new Date().toISOString();
    if (accessScope === 'campaign' && !inviteTarget.campaignId) {
      return NextResponse.json(
        { error: 'This invite is missing its campaign target' },
        { status: 400 }
      );
    }

    let membershipAlreadyExists = false;
    if (accessScope === 'workspace') {
      const { data: existingMembership, error: membershipLookupError } = await admin
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('workspace_id', invite.workspace_id)
        .eq('user_id', requestUser.id)
        .maybeSingle();

      if (membershipLookupError) {
        console.error('[invite-accept] membership lookup error:', membershipLookupError);
        return NextResponse.json(
          { error: 'Failed to accept invite' },
          { status: 500 }
        );
      }

      membershipAlreadyExists = !!existingMembership?.workspace_id;
    } else if (inviteTarget.campaignId) {
      const { data: existingCampaignMembership, error: campaignMembershipLookupError } = await admin
        .from('campaign_members')
        .select('campaign_id')
        .eq('campaign_id', inviteTarget.campaignId)
        .eq('user_id', requestUser.id)
        .maybeSingle();

      if (campaignMembershipLookupError) {
        console.error('[invite-accept] campaign membership lookup error:', campaignMembershipLookupError);
        return NextResponse.json(
          { error: 'Failed to accept invite' },
          { status: 500 }
        );
      }

      membershipAlreadyExists = !!existingCampaignMembership?.campaign_id;
    }

    const acceptedByCurrentUser =
      invite.accepted_by_user_id === requestUser.id || membershipAlreadyExists;

    const inviteStatus = invite.status ?? (invite.accepted_at ? 'accepted' : 'pending');

    if ((inviteStatus === 'accepted' || inviteStatus === 'expired') && acceptedByCurrentUser) {
      console.info('[invite-accept] duplicate accept resolved safely', {
        inviteId: invite.id,
        workspaceId: invite.workspace_id,
        userId: requestUser.id,
        accessScope,
        result: 'already_accepted',
      });
      return inviteAcceptedResponse({
        workspaceId: invite.workspace_id,
        campaignId: inviteTarget.campaignId,
        sessionId: inviteTarget.sessionId,
        accessScope,
        alreadyAccepted: true,
      });
    }

    if (inviteStatus !== 'pending') {
      return NextResponse.json(
        { error: 'This invite has already been used' },
        { status: 400 }
      );
    }

    let { data: acceptedInvite, error: updateError } = await markInviteAccepted(
      admin,
      invite.id,
      requestUser.id,
      nowIso
    );
    let membershipEnsuredByLegacyFallback = false;

    if (accessScope === 'workspace' && updateError && isLegacyAcceptedTriggerNullUserError(updateError)) {
      const { error: legacyMembershipError } = await ensureMembership(
        admin,
        invite,
        requestUser.id,
        nowIso
      );
      if (legacyMembershipError) {
        console.error('[invite-accept] legacy membership upsert error:', legacyMembershipError);
        return NextResponse.json(
          { error: 'Failed to accept invite' },
          { status: 500 }
        );
      }

      const legacyInviteUpdate = await admin
        .from('workspace_invites')
        .update({
          status: 'expired',
          accepted_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', invite.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      acceptedInvite = legacyInviteUpdate.data;
      updateError = legacyInviteUpdate.error;
      membershipEnsuredByLegacyFallback = true;
    }

    if (updateError) {
      console.error('[invite-accept] invite update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to accept invite' },
        { status: 500 }
      );
    }

    if (!acceptedInvite && !membershipAlreadyExists) {
      const { data: refreshedInvite, error: refreshedInviteError } = await admin
        .from('workspace_invites')
        .select('id, status')
        .eq('id', invite.id)
        .maybeSingle();

      if (
        refreshedInviteError ||
        !refreshedInvite?.id ||
        (refreshedInvite.status !== 'accepted' && refreshedInvite.status !== 'expired')
      ) {
        console.error('[invite-accept] invite race recovery failed:', refreshedInviteError);
        return NextResponse.json(
          { error: 'Failed to accept invite' },
          { status: 500 }
        );
      }
    }

    if (!membershipAlreadyExists && !membershipEnsuredByLegacyFallback) {
      const membershipUpsertResult =
        accessScope === 'workspace'
          ? await ensureMembership(admin, invite, requestUser.id, nowIso)
          : await ensureCampaignMembership(
              admin,
              inviteTarget.campaignId!,
              invite,
              requestUser.id
            );
      const membershipUpsertError = membershipUpsertResult.error;

      if (membershipUpsertError) {
        console.error('[invite-accept] access upsert error:', membershipUpsertError);
        return NextResponse.json(
          { error: 'Failed to accept invite' },
          { status: 500 }
        );
      }
    }

    const { error: profileEnsureError } = await admin
      .from('user_profiles')
      .upsert(
        {
          user_id: requestUser.id,
        },
        { onConflict: 'user_id' }
      );

    if (profileEnsureError) {
      console.warn('Accept invite: failed to ensure user profile exists', profileEnsureError);
    }

    if (firstName || lastName) {
      const nameUpdates: { first_name?: string | null; last_name?: string | null } = {};
      if (firstName) {
        nameUpdates.first_name = firstName;
      }
      if (lastName) {
        nameUpdates.last_name = lastName;
      }

      const { data: updatedProfiles, error: profileNameError } = await admin
        .from('user_profiles')
        .update(nameUpdates)
        .eq('user_id', requestUser.id)
        .select('user_id');

      if (profileNameError) {
        console.warn('[invite-accept] failed to update profile names', profileNameError);
      } else if (!updatedProfiles || updatedProfiles.length === 0) {
        const { error: profileNameInsertError } = await admin
          .from('user_profiles')
          .insert({
            user_id: requestUser.id,
            ...nameUpdates,
          });
        if (profileNameInsertError) {
          console.warn('[invite-accept] failed to insert profile names', profileNameInsertError);
        }
      }

      const fullName = [firstName, lastName]
        .filter((part) => Boolean(part))
        .join(' ')
        .trim();

      const { error: mirrorProfileError } = await admin
        .from('profiles')
        .update({
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
          full_name: fullName || null,
          updated_at: nowIso,
        })
        .eq('id', requestUser.id);

      if (mirrorProfileError) {
        console.warn('[invite-accept] failed to mirror profile names', mirrorProfileError);
      }
    }

    if (accessScope === 'workspace') {
      const { error: workspacePreferenceError } = await admin
        .from('user_profiles')
        .update({
          current_workspace_id: invite.workspace_id,
        })
        .eq('user_id', requestUser.id);

      if (workspacePreferenceError) {
        console.warn('Accept invite: failed to update current workspace preference', workspacePreferenceError);
      }
    }

    console.info('[invite-accept] invite accepted', {
      inviteId: invite.id,
      workspaceId: invite.workspace_id,
      userId: requestUser.id,
      accessScope,
      membershipAlreadyExists,
    });

    return inviteAcceptedResponse({
      workspaceId: invite.workspace_id,
      campaignId: inviteTarget.campaignId,
      sessionId: inviteTarget.sessionId,
      accessScope,
      alreadyAccepted: false,
    });
  } catch (e) {
    console.error('Accept invite error:', e);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
