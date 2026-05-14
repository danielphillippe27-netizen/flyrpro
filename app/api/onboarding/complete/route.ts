import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  PARTNER_EXCLUSIVE_TRIAL_DAYS,
  WORKSPACE_TRIAL_DAYS,
} from '@/app/lib/billing/workspace-trial';
import {
  buildJoinUrl,
  createWorkspaceInviteRecord,
  findPendingWorkspaceInviteByEmail,
  normalizeInviteEmail,
  updateWorkspaceInviteRecord,
} from '@/app/api/team/_lib/manage';
import {
  normalizeAmbassadorReferralCodeInput,
  resolveApprovedAmbassadorReferralCode,
} from '@/app/lib/billing/ambassador-program';
import { sendWorkspaceInviteEmail } from '@/lib/email/resend';
import {
  FLYR_PARTNER_FREE_FOREVER_REFERRAL_CODE,
  isFlyrPartnerFreeForeverOffer,
} from '@/components/offers/partnerOfferUtils';
import { normalizeCountryCode } from '@/lib/countries';

const INDUSTRIES = [
  'Real Estate',
  'Logistics',
  'Sales',
  'Pest Control',
  'HVAC',
  'Insurance',
  'Solar',
  'Other',
] as const;

const INVITE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmailArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeInviteEmail(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = requestUser.id;

    const body = await request.json();
    const {
      firstName,
      lastName,
      countryCode,
      workspaceName,
      industry,
      referralCode,
      useCase,
      maxSeats,
      brokerage,
      brokerageId,
      teamMemberEmails,
    } = body as {
      firstName?: string;
      lastName?: string;
      countryCode?: string;
      workspaceName?: string;
      industry?: string;
      referralCode?: string | null;
      useCase?: 'solo' | 'team';
      maxSeats?: number;
      brokerage?: string;
      brokerageId?: string;
      partnerOfferToken?: string;
      teamMemberEmails?: string[];
    };

    const admin = createAdminClient();

    const normalizedCountryCode = normalizeCountryCode(countryCode);

    if (firstName !== undefined || lastName !== undefined || countryCode !== undefined) {
      const normalizedFirstName =
        typeof firstName === 'string' ? firstName.trim() || null : undefined;
      const normalizedLastName =
        typeof lastName === 'string' ? lastName.trim() || null : undefined;
      const profileUpdates: Record<string, string | null> = {};
      if (normalizedFirstName !== undefined) {
        profileUpdates.first_name = normalizedFirstName;
      }
      if (normalizedLastName !== undefined) {
        profileUpdates.last_name = normalizedLastName;
      }
      if (countryCode !== undefined) {
        profileUpdates.country_code = normalizedCountryCode;
      }

      const { data: updatedProfiles, error: profileError } = await admin
        .from('user_profiles')
        .update(profileUpdates)
        .eq('user_id', userId)
        .select('user_id');

      if (profileError) {
        return NextResponse.json(
          { error: 'Failed to update profile' },
          { status: 500 }
        );
      }

      // Safety: create row if trigger/backfill didn't create it yet.
      if (!updatedProfiles || updatedProfiles.length === 0) {
        const { error: insertProfileError } = await admin
          .from('user_profiles')
          .insert({
            user_id: userId,
            ...profileUpdates,
          });
        if (insertProfileError) {
          return NextResponse.json(
            { error: 'Failed to create profile' },
            { status: 500 }
          );
        }
      }

      // Keep legacy public.profiles name fields in sync for admin/reporting queries.
      const fullName =
        [normalizedFirstName, normalizedLastName]
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
          .join(' ')
          .trim() || null;
      const { error: mirrorProfileError } = await admin
        .from('profiles')
        .update({
          ...(normalizedFirstName !== undefined ? { first_name: normalizedFirstName } : {}),
          ...(normalizedLastName !== undefined ? { last_name: normalizedLastName } : {}),
          ...(countryCode !== undefined ? { country_code: normalizedCountryCode } : {}),
          full_name: fullName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (mirrorProfileError) {
        console.warn('Onboarding: failed to mirror names into profiles', mirrorProfileError);
      }
    }

    // Use admin client so we always find an existing owner workspace (avoids RLS/race creating duplicates)
    let workspaceId = await (async () => {
      const { data: memberships } = await admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId)
        .eq('role', 'owner')
        .order('created_at', { ascending: true })
        .limit(1);

      return memberships?.[0]?.workspace_id ?? null;
    })();

    // If user has no owner workspace (e.g. account created before workspace trigger or backfill missed them),
    // create one so onboarding can complete.
    if (!workspaceId) {
      const initialName =
        typeof workspaceName === 'string' && workspaceName.trim()
          ? workspaceName.trim()
          : 'My Workspace';
      const { data: newWorkspace, error: createErr } = await admin
        .from('workspaces')
        .insert({
          name: initialName,
          owner_id: userId,
        })
        .select('id')
        .single();

      if (createErr || !newWorkspace?.id) {
        console.error('Onboarding: failed to create workspace', createErr);
        return NextResponse.json(
          { error: 'Failed to create workspace. Please try again.' },
          { status: 500 }
        );
      }

      const { error: memberErr } = await admin
        .from('workspace_members')
        .insert({
          workspace_id: newWorkspace.id,
          user_id: userId,
          role: 'owner',
        });

      if (memberErr) {
        console.error('Onboarding: failed to add owner membership', memberErr);
        return NextResponse.json(
          { error: 'Failed to set up workspace. Please try again.' },
          { status: 500 }
        );
      }

      workspaceId = newWorkspace.id;
    }

    const { data: currentWorkspace, error: currentWorkspaceError } = await admin
      .from('workspaces')
      .select('subscription_status, trial_ends_at, onboarding_completed_at')
      .eq('id', workspaceId)
      .maybeSingle();

    if (currentWorkspaceError) {
      return NextResponse.json(
        { error: 'Failed to load workspace state' },
        { status: 500 }
      );
    }

    const currentSubscriptionStatus = currentWorkspace?.subscription_status ?? 'inactive';
    const currentTrialEndsAt =
      typeof currentWorkspace?.trial_ends_at === 'string'
        ? currentWorkspace.trial_ends_at
        : null;
    const onboardingWasComplete = !!currentWorkspace?.onboarding_completed_at;
    const partnerOfferToken =
      typeof body?.partnerOfferToken === 'string' && body.partnerOfferToken.trim()
        ? body.partnerOfferToken.trim()
        : null;

    let isValidPartnerExclusiveOffer = false;
    let partnerOfferReferralCode: string | null = null;
    if (partnerOfferToken) {
      const { data: offer } = await admin
        .from('partner_offers')
        .select('id, offer_title, offer_message, expires_at, revoked_at, max_views, view_count')
        .eq('token', partnerOfferToken)
        .maybeSingle();
      if (offer) {
        const notRevoked = !offer.revoked_at;
        const notExpired = new Date(offer.expires_at).getTime() > Date.now();
        const underViewLimit =
          offer.max_views == null || offer.view_count < offer.max_views;
        isValidPartnerExclusiveOffer = notRevoked && notExpired && underViewLimit;
        if (
          isValidPartnerExclusiveOffer &&
          isFlyrPartnerFreeForeverOffer(offer.offer_title, offer.offer_message)
        ) {
          partnerOfferReferralCode = FLYR_PARTNER_FREE_FOREVER_REFERRAL_CODE;
        }
      }
    }

    const trialDays = isValidPartnerExclusiveOffer
      ? PARTNER_EXCLUSIVE_TRIAL_DAYS
      : WORKSPACE_TRIAL_DAYS;

    const shouldStartTrial =
      !onboardingWasComplete &&
      currentSubscriptionStatus === 'inactive' &&
      !currentTrialEndsAt;
    const startedTrialEndsAt = shouldStartTrial
      ? new Date(
          Date.now() + trialDays * 24 * 60 * 60 * 1000
        ).toISOString()
      : null;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      onboarding_completed_at: new Date().toISOString(),
    };

    if (typeof workspaceName === 'string' && workspaceName.trim()) {
      updates.name = workspaceName.trim();
    }
    if (typeof industry === 'string' && industry.trim()) {
      updates.industry = INDUSTRIES.includes(industry as (typeof INDUSTRIES)[number])
        ? industry
        : industry.trim();
    }
    if (referralCode !== undefined || partnerOfferReferralCode) {
      const normalizedReferralCode =
        partnerOfferReferralCode ??
        (typeof referralCode === 'string' && referralCode.trim()
          ? normalizeAmbassadorReferralCodeInput(referralCode)
          : null);

      if (normalizedReferralCode && !partnerOfferReferralCode) {
        const ambassadorReferral = await resolveApprovedAmbassadorReferralCode(
          admin,
          normalizedReferralCode
        );

        if (ambassadorReferral?.referralStats?.isAtLimit) {
          return NextResponse.json(
            {
              error:
                'That ambassador referral code has reached its limit. Please ask for a new code.',
            },
            { status: 400 }
          );
        }
      }

      updates.referral_code_used = normalizedReferralCode;
    }
    if (maxSeats !== undefined || useCase !== undefined) {
      const requestedSeats =
        Number.isFinite(maxSeats) && typeof maxSeats === 'number'
          ? Math.trunc(maxSeats)
          : NaN;
      if (Number.isFinite(requestedSeats) && requestedSeats > 0) {
        updates.max_seats = Math.min(100, requestedSeats);
      } else if (useCase === 'team') {
        updates.max_seats = 2;
      } else if (useCase === 'solo') {
        updates.max_seats = 1;
      }
    }

    if (shouldStartTrial && startedTrialEndsAt) {
      updates.subscription_status = 'trialing';
      updates.trial_ends_at = startedTrialEndsAt;
    }

    // Brokerage: persist brokerage_id when selected, else try template match or store custom brokerage_name
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof brokerageId === 'string' && uuidRegex.test(brokerageId.trim())) {
      updates.brokerage_id = brokerageId.trim();
      updates.brokerage_name = null;
    } else if (typeof brokerage === 'string' && brokerage.trim()) {
      const sanitized = brokerage
        .trim()
        .replace(/\s+/g, ' ')
        .trim();
      const { data: match } = await admin
        .from('brokerages')
        .select('id')
        .ilike('name', sanitized)
        .limit(1)
        .maybeSingle();
      if (match?.id) {
        updates.brokerage_id = match.id;
        updates.brokerage_name = null;
      } else {
        updates.brokerage_id = null;
        updates.brokerage_name = sanitized;
      }
    }

    const { error: workspaceError } = await admin
      .from('workspaces')
      .update(updates)
      .eq('id', workspaceId);

    if (workspaceError) {
      return NextResponse.json(
        { error: 'Failed to update workspace' },
        { status: 500 }
      );
    }

    const resultingSubscriptionStatus = shouldStartTrial
      ? 'trialing'
      : currentSubscriptionStatus;
    const resultingTrialEndsAt = shouldStartTrial
      ? startedTrialEndsAt
      : currentTrialEndsAt;
    const hasAccess =
      resultingSubscriptionStatus === 'active' ||
      (resultingSubscriptionStatus === 'trialing' &&
        (!resultingTrialEndsAt || new Date(resultingTrialEndsAt) > new Date()));

    const normalizedTeamInviteEmails = normalizeEmailArray(teamMemberEmails);
    const inviteResults: Array<{ email: string; sent: boolean; error?: string }> = [];
    if (normalizedTeamInviteEmails.length > 0) {
      const inviteWorkspaceName =
        (typeof updates.name === 'string' && updates.name.trim()) ||
        (typeof workspaceName === 'string' && workspaceName.trim()) ||
        'your workspace';

      for (const email of normalizedTeamInviteEmails) {
        if (requestUser.email && email === requestUser.email.toLowerCase()) {
          inviteResults.push({
            email,
            sent: false,
            error: 'Skipped inviter email',
          });
          continue;
        }

        const { data: memberAlreadyExists } = await admin.rpc(
          'workspace_has_member_email',
          {
            p_workspace_id: workspaceId,
            p_email: email,
          }
        );

        if (memberAlreadyExists === true) {
          inviteResults.push({
            email,
            sent: false,
            error: 'Already a workspace member',
          });
          continue;
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + INVITE_WINDOW_MS).toISOString();
        const existingInviteLookup = await findPendingWorkspaceInviteByEmail(
          admin,
          workspaceId,
          email
        );
        const existingInvite = existingInviteLookup.data;

        let inviteToken: string | null = null;

        if (
          existingInvite?.id &&
          existingInvite.expires_at &&
          new Date(existingInvite.expires_at).getTime() > now.getTime()
        ) {
          inviteToken = existingInvite.token;
        } else if (existingInvite?.id) {
          const refreshedToken = crypto.randomUUID();
          const refreshedInvite = await updateWorkspaceInviteRecord(
            admin,
            existingInvite.id,
            {
              role: 'member',
              token: refreshedToken,
              invited_by: requestUser.id,
              expires_at: expiresAt,
              last_sent_at: now.toISOString(),
              updated_at: now.toISOString(),
            }
          );
          inviteToken = refreshedInvite.data?.token ?? null;
        } else {
          const token = crypto.randomUUID();
          const createdInvite = await createWorkspaceInviteRecord(admin, {
            workspace_id: workspaceId,
            email,
            role: 'member',
            token,
            status: 'pending',
            invited_by: requestUser.id,
            expires_at: expiresAt,
            last_sent_at: now.toISOString(),
          });
          inviteToken = createdInvite.data?.token ?? null;
        }

        if (!inviteToken) {
          inviteResults.push({
            email,
            sent: false,
            error: 'Failed to create invite',
          });
          continue;
        }

        try {
          await sendWorkspaceInviteEmail({
            to: email,
            joinUrl: buildJoinUrl(request, inviteToken),
            workspaceName: inviteWorkspaceName,
            role: 'member',
            inviterEmail: requestUser.email,
            expiresAt,
          });
          inviteResults.push({ email, sent: true });
        } catch (inviteError) {
          inviteResults.push({
            email,
            sent: false,
            error:
              inviteError instanceof Error
                ? inviteError.message
                : 'Invite created but email failed',
          });
        }
      }
    }

    const nextPath = hasAccess ? '/home' : '/subscribe';
    const redirect = `/download-ios?stage=post-onboarding&next=${encodeURIComponent(nextPath)}`;

    return NextResponse.json({
      success: true,
      redirect,
      invites: {
        attempted: normalizedTeamInviteEmails.length,
        sent: inviteResults.filter((result) => result.sent).length,
        results: inviteResults,
      },
    });
  } catch (e) {
    console.error('Onboarding complete error:', e);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
