import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

type InviteRow = {
  id: string;
  workspace_id: string;
  email: string;
  role: 'admin' | 'member';
  status: string;
  expires_at: string | null;
  accepted_by_user_id?: string | null;
};

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
  const withAcceptedBy = await admin
    .from('workspace_invites')
    .select('id, workspace_id, email, role, status, expires_at, accepted_by_user_id')
    .eq('token', token)
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

  if (!missingAcceptedByColumn) {
    return { invite: null, error: withAcceptedBy.error };
  }

  const fallback = await admin
    .from('workspace_invites')
    .select('id, workspace_id, email, role, status, expires_at')
    .eq('token', token)
    .maybeSingle();

  return {
    invite: fallback.data
      ? ({ ...fallback.data, accepted_by_user_id: null } as InviteRow)
      : null,
    error: fallback.error,
  };
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
    const userEmail = (requestUser.email ?? '').toLowerCase().trim();

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

    const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null;
    if (expiresAt && expiresAt <= new Date()) {
      return NextResponse.json(
        { error: 'This invite has expired' },
        { status: 400 }
      );
    }

    const inviteEmail = (invite.email ?? '').toLowerCase().trim();
    if (userEmail !== inviteEmail) {
      return NextResponse.json(
        { error: 'This invite was sent to a different email address' },
        { status: 403 }
      );
    }

    const nowIso = new Date().toISOString();
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

    const membershipAlreadyExists = !!existingMembership?.workspace_id;
    const acceptedByCurrentUser =
      invite.accepted_by_user_id === requestUser.id || membershipAlreadyExists;

    if ((invite.status === 'accepted' || invite.status === 'expired') && acceptedByCurrentUser) {
      console.info('[invite-accept] duplicate accept resolved safely', {
        inviteId: invite.id,
        workspaceId: invite.workspace_id,
        userId: requestUser.id,
        result: 'already_accepted',
      });
      return NextResponse.json({
        success: true,
        alreadyAccepted: true,
        workspaceId: invite.workspace_id,
        redirect: '/home',
      });
    }

    if (invite.status !== 'pending') {
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

    if (updateError && isLegacyAcceptedTriggerNullUserError(updateError)) {
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
      const { error: membershipUpsertError } = await ensureMembership(
        admin,
        invite,
        requestUser.id,
        nowIso
      );

      if (membershipUpsertError) {
        console.error('[invite-accept] membership upsert error:', membershipUpsertError);
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

    const { error: workspacePreferenceError } = await admin
      .from('user_profiles')
      .update({
        current_workspace_id: invite.workspace_id,
      })
      .eq('user_id', requestUser.id);

    if (workspacePreferenceError) {
      console.warn('Accept invite: failed to update current workspace preference', workspacePreferenceError);
    }

    console.info('[invite-accept] invite accepted', {
      inviteId: invite.id,
      workspaceId: invite.workspace_id,
      userId: requestUser.id,
      membershipAlreadyExists,
    });

    return NextResponse.json({
      success: true,
      alreadyAccepted: false,
      workspaceId: invite.workspace_id,
      redirect: '/home',
    });
  } catch (e) {
    console.error('Accept invite error:', e);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
