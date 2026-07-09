import { after, NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  buildJoinUrl,
  createWorkspaceInviteRecord,
  findPendingWorkspaceInviteByEmail,
  normalizeInviteEmail,
  updateWorkspaceInviteRecord,
} from '@/app/api/team/_lib/manage';
import {
  normalizeAmbassadorReferralCodeInput,
  upsertAmbassadorReferralAttribution,
  validateAmbassadorReferralCodeForOnboarding,
  type ValidAmbassadorReferral,
} from '@/app/lib/billing/ambassador-program';
import {
  normalizeSalespersonReferralCodeInput,
  resolveActiveSalespersonReferralCode,
} from '@/app/lib/billing/salespeople';
import {
  buildConnectBusinessProfilePrefill,
  buildIndividualConnectPrefill,
  isMissingStripeConnectAccountError,
} from '@/app/lib/billing/stripe-connect-prefill';
import { isStripeSecretKeyConfigured } from '@/app/lib/billing/stripe-env';
import { sendWorkspaceInviteEmail } from '@/lib/email/resend';
import { stripe } from '@/lib/stripe';
import {
  FLYR_PARTNER_FREE_FOREVER_REFERRAL_CODE,
  isFlyrPartnerFreeForeverOffer,
} from '@/components/offers/partnerOfferUtils';
import { normalizeCountryCode } from '@/lib/countries';
import { sanitizeTrackingParam } from '@/app/lib/ambassador/portal';
import { markConvertedDemoLinks } from '@/lib/dialer/demo-link-tracking';
import { seedStarterCampaignForWorkspace } from '@/lib/onboarding/demo';

const INDUSTRIES = [
  'Home service',
  'Solar',
  'Roofing & Exteriors',
  'HVAC',
  'Real Estate',
  'Insurance',
  'Landscaping',
  'Pest Control',
  'Political / Canvassing',
  'Pool Service',
  'Other',
] as const;

const INVITE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SELF_SERVE_CAMPAIGN_NAME = 'FIRST CAMPAIGN';

type SalespersonInviteRow = {
  id: string;
  full_name: string;
  email: string;
  status: 'active' | 'paused' | 'inactive';
  referral_code: string | null;
  founder_user_id: string | null;
  workspace_id: string | null;
  invite_token: string | null;
  approved_at: string | null;
  onboarding_completed_at: string | null;
  stripe_connect_account_id: string | null;
};

function isCampaignTypeConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string | null };
  return (
    candidate.code === '23514' ||
    candidate.message?.includes('campaigns_type_check') ||
    candidate.details?.includes('campaigns_type_check') ||
    false
  );
}

async function findFirstWorkspaceCampaign(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<string | null> {
  const { data } = await admin
    .from('campaigns')
    .select('id')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

async function createSelfServeCampaignFallback(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  userId: string;
  name?: string | null;
  region?: string | null;
  polygon?: GeoJSON.Polygon | null;
  bbox?: number[] | null;
}): Promise<string> {
  const existingCampaignId = await findFirstWorkspaceCampaign(params.admin, params.workspaceId);
  if (existingCampaignId) return existingCampaignId;

  const campaignName =
    typeof params.name === 'string' && params.name.trim()
      ? `${params.name.trim()} Campaign`
      : SELF_SERVE_CAMPAIGN_NAME;
  const basePayload = {
    owner_id: params.userId,
    workspace_id: params.workspaceId,
    name: campaignName,
    title: campaignName,
    description: params.polygon
      ? 'Self-serve prospecting map created from the demo flow.'
      : 'Campaign created from the self-serve first campaign setup.',
    type: 'prospecting',
    address_source: 'map',
    region: params.region || null,
    seed_query: null,
    tags: params.polygon ? 'self-serve-demo,prospecting-map' : 'self-serve-demo',
    bbox: params.bbox ?? null,
    territory_boundary: params.polygon ?? null,
    total_flyers: 0,
    scans: 0,
    conversions: 0,
    status: 'draft',
    provision_status: params.polygon ? 'pending' : null,
    provision_phase: params.polygon ? 'created' : null,
    provision_source: null,
    provisioned_at: null,
    addresses_ready_at: null,
    map_ready_at: null,
    optimized_at: null,
    has_parcels: false,
    building_link_confidence: 0,
    map_mode: 'standard_pins',
    parcel_enrichment_status: 'not_started',
    link_quality_status: 'unknown',
    link_quality_score: 0,
    link_quality_reason: null,
    link_quality_checked_at: null,
    link_quality_metrics: {},
  };

  let { data: campaign, error } = await params.admin
    .from('campaigns')
    .insert(basePayload)
    .select('id')
    .single();

  if (error && isCampaignTypeConstraintError(error)) {
    const retry = await params.admin
      .from('campaigns')
      .insert({
        ...basePayload,
        type: 'flyer',
      })
      .select('id')
      .single();
    campaign = retry.data;
    error = retry.error;
  }

  if (error || !campaign?.id) {
    console.error('[onboarding/complete] self-serve fallback campaign insert failed:', error);
    throw new Error('Failed to create starter campaign.');
  }

  return campaign.id;
}

function isFiniteNumberArray(value: unknown, expectedLength: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === expectedLength &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function normalizeSelfServeCampaignDraft(value: unknown): {
  name: string | null;
  polygon: GeoJSON.Polygon;
  bbox: number[] | null;
} | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    name?: unknown;
    polygon?: unknown;
    bbox?: unknown;
  };
  const polygon = candidate.polygon as GeoJSON.Polygon | null;
  if (
    !polygon ||
    polygon.type !== 'Polygon' ||
    !Array.isArray(polygon.coordinates) ||
    polygon.coordinates.length === 0
  ) {
    return null;
  }

  const hasUsableRing = polygon.coordinates.some(
    (ring) =>
      Array.isArray(ring) &&
      ring.length >= 4 &&
      ring.every((point) => isFiniteNumberArray(point, 2))
  );
  if (!hasUsableRing) return null;

  return {
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : null,
    polygon,
    bbox: isFiniteNumberArray(candidate.bbox, 4) ? candidate.bbox : null,
  };
}

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

async function createSalespersonStripeOnboardingRedirect(params: {
  admin: ReturnType<typeof createAdminClient>;
  origin: string;
  salesperson: SalespersonInviteRow;
}): Promise<string | null> {
  if (!isStripeSecretKeyConfigured()) return null;

  try {
    let accountId = params.salesperson.stripe_connect_account_id;
    const individual = buildIndividualConnectPrefill({
      email: params.salesperson.email,
      fullName: params.salesperson.full_name,
      title: 'Salesperson',
    });
    const businessProfile = buildConnectBusinessProfilePrefill({
      origin: params.origin,
      productDescription: 'FLYR direct sales commissions and salesperson payouts',
    });

    const createAccount = async () => {
      const account = await stripe.accounts.create({
        type: 'express',
        email: params.salesperson.email,
        business_type: 'individual',
        individual,
        business_profile: businessProfile,
        metadata: {
          salesperson_id: params.salesperson.id,
          salesperson_name: params.salesperson.full_name,
          source: 'flyr_salesperson_onboarding',
        },
      });
      return account.id;
    };

    if (!accountId) {
      accountId = await createAccount();
    } else {
      try {
        const existingAccount = await stripe.accounts.retrieve(accountId);
        if (!existingAccount.details_submitted) {
          await stripe.accounts.update(accountId, {
            business_profile: businessProfile,
            individual,
          });
        }
      } catch (error) {
        if (isMissingStripeConnectAccountError(error)) {
          accountId = await createAccount();
        } else {
          console.warn('[onboarding/complete] salesperson Stripe prefill update failed:', error);
        }
      }
    }

    const refreshUrl = new URL('/onboarding', params.origin);
    if (params.salesperson.invite_token) {
      refreshUrl.searchParams.set('salespersonInvite', params.salesperson.invite_token);
    }
    refreshUrl.searchParams.set('stripeOnboarding', 'refresh');

    const returnUrl = new URL('/home', params.origin);
    returnUrl.searchParams.set('stripeOnboarding', 'complete');

    const createAccountLink = async (stripeAccountId: string) =>
      stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: refreshUrl.toString(),
        return_url: returnUrl.toString(),
        type: 'account_onboarding',
      });

    let accountLink;
    try {
      accountLink = await createAccountLink(accountId);
    } catch (error) {
      if (!isMissingStripeConnectAccountError(error)) throw error;
      accountId = await createAccount();
      accountLink = await createAccountLink(accountId);
    }

    const account = await stripe.accounts.retrieve(accountId);
    await params.admin
      .from('salespeople')
      .update({
        stripe_connect_account_id: accountId,
        stripe_onboarding_completed: account.details_submitted ?? false,
        stripe_details_submitted: account.details_submitted ?? false,
        stripe_charges_enabled: account.charges_enabled ?? false,
        stripe_payouts_enabled: account.payouts_enabled ?? false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.salesperson.id);

    return accountLink.url;
  } catch (error) {
    console.warn('[onboarding/complete] salesperson Stripe onboarding link failed:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  let requestedClientSource = '';
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
      referralSource,
      referralCampaign,
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
      referralSource?: string | null;
      referralCampaign?: string | null;
      useCase?: 'solo' | 'team';
      maxSeats?: number;
      brokerage?: string;
      brokerageId?: string;
      partnerOfferToken?: string;
      salespersonInviteToken?: string;
      clientSource?: string;
      teamMemberEmails?: string[];
      openAppAfterCompletion?: boolean;
      openCampaignCreateAfterCompletion?: boolean;
      resumeCampaignAfterOnboarding?: boolean;
      selfServeCampaignDraft?: unknown;
    };
    const clientSource =
      typeof body?.clientSource === 'string' ? body.clientSource.trim().toLowerCase() : '';
    requestedClientSource = clientSource;
    const isSelfServeDemoCompletion = clientSource === 'self-serve-demo';
    const selfServeCampaignDraft = isSelfServeDemoCompletion
      ? normalizeSelfServeCampaignDraft(body?.selfServeCampaignDraft)
      : null;

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

    const salespersonInviteToken =
      typeof body?.salespersonInviteToken === 'string' && body.salespersonInviteToken.trim()
        ? body.salespersonInviteToken.trim()
        : null;

    if (salespersonInviteToken) {
      const { data: salesperson, error: salespersonError } = await admin
        .from('salespeople')
        .select(
          'id, full_name, email, status, referral_code, founder_user_id, workspace_id, invite_token, approved_at, onboarding_completed_at, stripe_connect_account_id'
        )
        .eq('invite_token', salespersonInviteToken)
        .maybeSingle();

      if (salespersonError) {
        return NextResponse.json(
          { error: 'Failed to validate salesperson invite' },
          { status: 500 }
        );
      }

      if (!salesperson || salesperson.status !== 'active') {
        return NextResponse.json(
          { error: 'This salesperson invite is invalid or inactive.' },
          { status: 400 }
        );
      }

      const inviteEmail =
        typeof salesperson.email === 'string' ? salesperson.email.trim().toLowerCase() : '';
      const userEmail = requestUser.email?.trim().toLowerCase() ?? '';
      if (!inviteEmail || !userEmail || inviteEmail !== userEmail) {
        return NextResponse.json(
          { error: `This salesperson invite was sent to ${salesperson.email}. Sign in with that email to continue.` },
          { status: 403 }
        );
      }

      const { data: danielSalesUser, error: danielSalesUserError } = await admin
        .from('profiles')
        .select('id')
        .ilike('email', 'danielsales@gmail.com')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (danielSalesUserError) {
        console.warn('[onboarding/complete] Daniel sales profile lookup failed', danielSalesUserError);
      }

      let founderUserId =
        typeof danielSalesUser?.id === 'string' && danielSalesUser.id
          ? danielSalesUser.id
          : typeof salesperson.founder_user_id === 'string' && salesperson.founder_user_id
            ? salesperson.founder_user_id
            : null;

      if (!founderUserId) {
        const { data: authUsers, error: authUserError } = await admin.auth.admin.listUsers();
        if (authUserError) {
          console.warn('[onboarding/complete] Daniel sales auth lookup failed', authUserError);
        }
        const danielAuthUser = authUsers?.users.find(
          (user) => user.email?.trim().toLowerCase() === 'danielsales@gmail.com'
        );
        founderUserId = danielAuthUser?.id ?? null;
      }

      if (!founderUserId) {
        return NextResponse.json(
          { error: 'The Daniel sales workspace owner is missing. Create danielsales@gmail.com before completing salesperson onboarding.' },
          { status: 400 }
        );
      }

      const nowIso = new Date().toISOString();
      let salespersonWorkspaceId: string | null = null;

      const { data: ownerMembership } = await admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', founderUserId)
        .eq('role', 'owner')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      salespersonWorkspaceId = ownerMembership?.workspace_id ?? null;

      if (!salespersonWorkspaceId) {
        const { data: createdWorkspace, error: createWorkspaceError } = await admin
          .from('workspaces')
          .insert({
            name: 'Daniel Sales Workspace',
            owner_id: founderUserId,
            industry: typeof industry === 'string' && industry.trim() ? industry.trim() : 'Real Estate',
            subscription_status: 'active',
            max_seats: 200,
            onboarding_completed_at: nowIso,
          })
          .select('id')
          .single();

        if (createWorkspaceError || !createdWorkspace?.id) {
          console.error('Salesperson onboarding: failed to create shared workspace', createWorkspaceError);
          return NextResponse.json(
            { error: 'Failed to create the shared salesperson workspace. Please try again.' },
            { status: 500 }
          );
        }

        salespersonWorkspaceId = createdWorkspace.id;
      } else {
        const { error: updateWorkspaceError } = await admin
          .from('workspaces')
          .update({
            owner_id: founderUserId,
            subscription_status: 'active',
            max_seats: 200,
            onboarding_completed_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', salespersonWorkspaceId);

        if (updateWorkspaceError) {
          return NextResponse.json(
            { error: 'Failed to update the shared salesperson workspace. Please try again.' },
            { status: 500 }
          );
        }
      }

      const { error: founderMembershipError } = await admin
        .from('workspace_members')
        .upsert(
          {
          workspace_id: salespersonWorkspaceId,
          user_id: founderUserId,
          role: 'owner',
            updated_at: nowIso,
          },
          { onConflict: 'workspace_id,user_id' }
        );

      if (founderMembershipError) {
        return NextResponse.json(
          { error: 'Failed to grant founder access to salesperson workspace.' },
          { status: 500 }
        );
      }

      const { error: salespersonMembershipError } = await admin
        .from('workspace_members')
        .upsert(
          {
            workspace_id: salespersonWorkspaceId,
            user_id: userId,
            role: 'member',
            updated_at: nowIso,
          },
          { onConflict: 'workspace_id,user_id' }
        );

      if (salespersonMembershipError) {
        return NextResponse.json(
          { error: 'Failed to grant salesperson workspace access.' },
          { status: 500 }
        );
      }

      await admin
        .from('user_profiles')
        .upsert({ user_id: userId, current_workspace_id: salespersonWorkspaceId });

      await admin
        .from('workspace_billing_addons')
        .upsert(
          {
            workspace_id: salespersonWorkspaceId,
            addon_key: 'power_dialer',
            status: 'active',
            quantity: 1,
            activated_at: nowIso,
            updated_at: nowIso,
          },
          { onConflict: 'workspace_id,addon_key' }
        );

      await admin
        .from('workspace_dialer_settings')
        .upsert(
          {
            workspace_id: salespersonWorkspaceId,
            enabled: true,
            allow_sms_followup: true,
            updated_at: nowIso,
          },
          { onConflict: 'workspace_id' }
        );

      const { error: salespersonUpdateError } = await admin
        .from('salespeople')
        .update({
          user_id: userId,
          founder_user_id: founderUserId,
          workspace_id: salespersonWorkspaceId,
          onboarding_completed_at: nowIso,
          approved_at: salesperson.approved_at ?? nowIso,
        })
        .eq('id', salesperson.id);

      if (salespersonUpdateError) {
        return NextResponse.json(
          { error: 'Salesperson workspace was created, but the salesperson record could not be updated.' },
          { status: 500 }
        );
      }

      await admin
        .from('salesperson_dialer_settings')
        .upsert(
          {
            salesperson_id: salesperson.id,
            workspace_id: salespersonWorkspaceId,
            updated_at: nowIso,
          },
          { onConflict: 'salesperson_id' }
        );

      const stripeOnboardingRedirect = await createSalespersonStripeOnboardingRedirect({
        admin,
        origin: request.nextUrl.origin,
        salesperson: {
          ...(salesperson as SalespersonInviteRow),
          workspace_id: salespersonWorkspaceId,
          onboarding_completed_at: nowIso,
          approved_at: salesperson.approved_at ?? nowIso,
        },
      });

      return NextResponse.json({
        success: true,
        redirect: stripeOnboardingRedirect ?? '/home',
        workspaceId: salespersonWorkspaceId,
        stripeOnboardingRedirect: Boolean(stripeOnboardingRedirect),
      });
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

    const { error: currentWorkspaceError } = await admin
      .from('workspaces')
      .select('onboarding_completed_at')
      .eq('id', workspaceId)
      .maybeSingle();

    if (currentWorkspaceError) {
      return NextResponse.json(
        { error: 'Failed to load workspace state' },
        { status: 500 }
      );
    }

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

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      onboarding_completed_at: new Date().toISOString(),
    };
    let onboardingAmbassadorReferral: ValidAmbassadorReferral | null = null;
    let normalizedAmbassadorReferralCode: string | null = null;

    if (typeof workspaceName === 'string' && workspaceName.trim()) {
      updates.name = workspaceName.trim();
    }
    if (typeof industry === 'string' && industry.trim()) {
      updates.industry = INDUSTRIES.includes(industry as (typeof INDUSTRIES)[number])
        ? industry
        : industry.trim();
    }
    if (referralCode !== undefined || partnerOfferReferralCode) {
      let normalizedReferralCode =
        partnerOfferReferralCode ??
        (typeof referralCode === 'string' && referralCode.trim()
          ? referralCode.trim().toUpperCase()
          : null);

      if (normalizedReferralCode && !partnerOfferReferralCode) {
        const salespersonReferralCode =
          normalizeSalespersonReferralCodeInput(normalizedReferralCode);
        const ambassadorReferralCode =
          normalizeAmbassadorReferralCodeInput(normalizedReferralCode);
        const [salespersonReferral, ambassadorReferralValidation] = await Promise.all([
          resolveActiveSalespersonReferralCode(admin, salespersonReferralCode),
          validateAmbassadorReferralCodeForOnboarding(admin, ambassadorReferralCode),
        ]);

        if (!ambassadorReferralValidation.ok && ambassadorReferralValidation.reason === 'maxed') {
          return NextResponse.json(
            {
              error: ambassadorReferralValidation.message,
            },
            { status: 400 }
          );
        }

        if (ambassadorReferralValidation.ok) {
          onboardingAmbassadorReferral = ambassadorReferralValidation.ambassador;
          normalizedAmbassadorReferralCode = ambassadorReferralValidation.referralCode;
          normalizedReferralCode = ambassadorReferralValidation.referralCode;
        } else if (salespersonReferral?.referral_code) {
          normalizedReferralCode = salespersonReferral.referral_code.trim().toUpperCase();
        } else if (!salespersonReferral) {
          return NextResponse.json(
            {
              error: ambassadorReferralValidation.message,
            },
            { status: 400 }
          );
        }
      }

      updates.referral_code_used = normalizedReferralCode;
    }
    if (isSelfServeDemoCompletion) {
      updates.referral_code_used = 'SELF_SERVE_DEMO';
    }

    if (maxSeats !== undefined || useCase !== undefined) {
      const requestedSeats =
        Number.isFinite(maxSeats) && typeof maxSeats === 'number'
          ? Math.trunc(maxSeats)
          : NaN;
      if (Number.isFinite(requestedSeats) && requestedSeats > 0) {
        updates.max_seats = Math.min(200, requestedSeats);
      } else if (useCase === 'team') {
        updates.max_seats = 2;
      } else if (useCase === 'solo') {
        updates.max_seats = 1;
      }
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

    if (onboardingAmbassadorReferral && normalizedAmbassadorReferralCode) {
      try {
        await upsertAmbassadorReferralAttribution(admin, {
          ambassador: onboardingAmbassadorReferral,
          referredUserId: userId,
          referredWorkspaceId: workspaceId,
          referralCode: normalizedAmbassadorReferralCode,
          source:
            typeof referralSource === 'string'
              ? sanitizeTrackingParam(referralSource)
              : null,
          campaign:
            typeof referralCampaign === 'string'
              ? sanitizeTrackingParam(referralCampaign)
              : null,
        });
      } catch (attributionError) {
        console.error(
          'Onboarding: failed to persist ambassador referral attribution',
          attributionError
        );
        return NextResponse.json(
          { error: 'Failed to save ambassador referral attribution' },
          { status: 500 }
        );
      }
    }

    if (typeof updates.referral_code_used === 'string') {
      await markConvertedDemoLinks({
        admin,
        referralCode: updates.referral_code_used,
        recipientEmail: requestUser.email,
        convertedUserId: userId,
        convertedWorkspaceId: workspaceId,
      });
    }

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

    const ownerInviteMembersPath = '/home?tab=settings&invite=members';
    const nextPath = ownerInviteMembersPath;
    const openAppAfterCompletion = body?.openAppAfterCompletion === true;
    const openCampaignCreateAfterCompletion = body?.openCampaignCreateAfterCompletion === true;
    const resumeCampaignAfterOnboarding = body?.resumeCampaignAfterOnboarding === true;
    let selfServeDemoSeed: Awaited<ReturnType<typeof seedStarterCampaignForWorkspace>> | null = null;
    let selfServeCampaignId: string | null = null;
    let selfServeProvisionCampaignId: string | null = null;
    if (clientSource === 'self-serve-demo' && !openCampaignCreateAfterCompletion) {
      if (selfServeCampaignDraft) {
        selfServeCampaignId = await createSelfServeCampaignFallback({
          admin,
          workspaceId,
          userId,
          name: selfServeCampaignDraft.name ?? (typeof workspaceName === 'string' ? workspaceName : null),
          region: normalizedCountryCode,
          polygon: selfServeCampaignDraft.polygon,
          bbox: selfServeCampaignDraft.bbox,
        });
        selfServeProvisionCampaignId = selfServeCampaignId;
      } else {
        try {
          selfServeDemoSeed = await seedStarterCampaignForWorkspace(admin, {
            workspaceId,
            userId,
            role: 'owner',
            memberCount: 1 + normalizedTeamInviteEmails.length,
            maxSeats:
              typeof updates.max_seats === 'number'
                ? updates.max_seats
                : typeof maxSeats === 'number'
                  ? maxSeats
                  : 1,
          });
          selfServeCampaignId = selfServeDemoSeed.campaignId;
        } catch (seedError) {
          console.warn('[onboarding/complete] self-serve replay seed failed; creating fallback campaign', seedError);
          selfServeCampaignId = await createSelfServeCampaignFallback({
            admin,
            workspaceId,
            userId,
            name: typeof workspaceName === 'string' ? workspaceName : null,
            region: normalizedCountryCode,
          });
        }
      }
    }
    if (selfServeProvisionCampaignId) {
      const provisionCampaignId = selfServeProvisionCampaignId;
      const origin = request.nextUrl.origin;
      const cookie = request.headers.get('cookie') ?? '';
      const { data: provisionState } = await admin
        .from('campaigns')
        .select('provision_status, provision_phase, map_ready_at')
        .eq('id', provisionCampaignId)
        .maybeSingle();
      const shouldStartProvision =
        !provisionState?.map_ready_at &&
        provisionState?.provision_status !== 'ready' &&
        (!provisionState?.provision_phase ||
          provisionState.provision_phase === 'created' ||
          provisionState.provision_phase === 'failed');

      if (shouldStartProvision) after(async () => {
        try {
          const response = await fetch(`${origin}/api/campaigns/provision`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify({ campaign_id: provisionCampaignId }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            console.warn(
              '[onboarding/complete] self-serve background provision failed:',
              payload?.error ?? response.statusText
            );
          }
        } catch (provisionError) {
          console.warn('[onboarding/complete] self-serve background provision failed:', provisionError);
        }
      });
    }
    const redirect =
      openCampaignCreateAfterCompletion
        ? `/campaigns/create?source=self-serve-demo&campaign=self-serve-campaign${
            resumeCampaignAfterOnboarding ? '&resumeCampaign=1' : ''
          }`
        : selfServeCampaignId
        ? `/campaigns/${selfServeCampaignId}?source=self-serve-demo`
        : openAppAfterCompletion || clientSource === 'android' || clientSource === 'dialer'
          ? nextPath
          : `/download-ios?stage=post-onboarding&next=${encodeURIComponent(nextPath)}`;

    return NextResponse.json({
      success: true,
      redirect,
      invites: {
        attempted: normalizedTeamInviteEmails.length,
        sent: inviteResults.filter((result) => result.sent).length,
        results: inviteResults,
      },
      starterCampaign: selfServeDemoSeed,
    });
  } catch (e) {
    console.error('Onboarding complete error:', e);
    if (requestedClientSource === 'self-serve-demo') {
      return NextResponse.json(
        { error: 'We could not create your starter campaign. Please try again.' },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
