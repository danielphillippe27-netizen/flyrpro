import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getWorkspaceDialerSettings,
} from '@/lib/dialer/server';
import {
  canDialerWorkspaceUseSharedDefault,
  getDialerWorkspaceAccessError,
  isDialerFounderBypassEmail,
  isDialerEnabledForWorkspace,
} from '@/lib/dialer/feature-gate';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { getWorkspacePowerDialerAddon } from '@/app/lib/billing/workspace-addons';
import {
  getPowerDialerAddonOffer,
  getRequestBillingCurrency,
} from '@/app/lib/billing/stripe-products';
import { normalizePhoneNumber } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UpdatePayload = {
  workspaceId?: string;
  enabled?: boolean;
  allowSmsFollowup?: boolean;
  defaultFromNumber?: string | null;
  defaultSmsFromNumber?: string | null;
  inboundForwardTo?: string | null;
};

async function resolveWorkspaceContext(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    workspaceId
  );

  if (!membership.workspaceId) {
    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 403 }
    );
  }

  return {
    admin,
    requestUser,
    workspaceId: membership.workspaceId,
    role: membership.role,
  };
}

async function buildSettingsResponse(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  role: string | null,
  userEmail: string | null,
  request: NextRequest
) {
  const founderBypassEnabled = isDialerFounderBypassEmail(userEmail);
  const featureEnabled = isDialerEnabledForWorkspace(workspaceId, userEmail);
  const sharedDefaultDialingEnabled = canDialerWorkspaceUseSharedDefault(workspaceId, userEmail);
  if (!featureEnabled) {
    return {
      workspaceId,
      role,
      canManage: role === 'owner' || role === 'admin',
      featureEnabled: false,
      sharedDefaultDialingEnabled: false,
      offer: null,
      addon: null,
      settings: null,
    };
  }

  const [settings, addon] = await Promise.all([
    getWorkspaceDialerSettings(admin, workspaceId),
    getWorkspacePowerDialerAddon(admin, workspaceId),
  ]);
  const offer = getPowerDialerAddonOffer(getRequestBillingCurrency(request));
  const addonStatus = founderBypassEnabled ? 'active' : addon.status;

  return {
    workspaceId,
    role,
    canManage: role === 'owner' || role === 'admin',
    featureEnabled: true,
    sharedDefaultDialingEnabled,
    offer: {
      priceId: offer.priceId || null,
      amount: offer.amount,
      currency: offer.currency,
      period: offer.period,
    },
    addon: {
      status: addonStatus,
      isActive: addonStatus === 'active',
      priceId: addon.stripe_price_id ?? null,
      amountCents: addon.amount_cents ?? null,
      currency: addon.currency ?? null,
    },
    settings,
  };
}

export async function GET(request: NextRequest) {
  const context = await resolveWorkspaceContext(request);
  if (context instanceof NextResponse) {
    return context;
  }

  const response = await buildSettingsResponse(
    context.admin,
    context.workspaceId,
    context.role,
    context.requestUser.email,
    request
  );
  return NextResponse.json(response);
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as UpdatePayload;
  const queryWorkspaceId = request.nextUrl.searchParams.get('workspaceId');

  const authContext = await resolveUserFromRequest(request);
  if (!authContext) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    authContext.id,
    body.workspaceId ?? queryWorkspaceId
  );

  if (!membership.workspaceId) {
    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 403 }
    );
  }

  if (!isDialerEnabledForWorkspace(membership.workspaceId, authContext.email)) {
    return NextResponse.json(
      { error: getDialerWorkspaceAccessError() },
      { status: 403 }
    );
  }

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only workspace owners and admins can manage dialer settings' },
      { status: 403 }
    );
  }

  const normalizedFrom = normalizePhoneNumber(body.defaultFromNumber ?? undefined);
  const normalizedSms = normalizePhoneNumber(body.defaultSmsFromNumber ?? undefined);
  const normalizedInbound = normalizePhoneNumber(body.inboundForwardTo ?? undefined);

  if (
    typeof body.defaultFromNumber === 'string' &&
    body.defaultFromNumber.trim().length > 0 &&
    (!normalizedFrom.isValid || !normalizedFrom.e164)
  ) {
    return NextResponse.json(
      { error: normalizedFrom.error ?? 'Dialer caller ID must be a valid phone number' },
      { status: 400 }
    );
  }

  if (
    typeof body.defaultSmsFromNumber === 'string' &&
    body.defaultSmsFromNumber.trim().length > 0 &&
    (!normalizedSms.isValid || !normalizedSms.e164)
  ) {
    return NextResponse.json(
      { error: normalizedSms.error ?? 'Dialer SMS number must be a valid phone number' },
      { status: 400 }
    );
  }

  if (
    typeof body.inboundForwardTo === 'string' &&
    body.inboundForwardTo.trim().length > 0 &&
    (!normalizedInbound.isValid || !normalizedInbound.e164)
  ) {
    return NextResponse.json(
      { error: normalizedInbound.error ?? 'Inbound forward number must be a valid phone number' },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    workspace_id: membership.workspaceId,
    updated_at: now,
  };

  if (typeof body.enabled === 'boolean') {
    updatePayload.enabled = body.enabled;
  }

  if (typeof body.allowSmsFollowup === 'boolean') {
    updatePayload.allow_sms_followup = body.allowSmsFollowup;
  }

  if (body.defaultFromNumber !== undefined) {
    updatePayload.default_from_number =
      typeof body.defaultFromNumber === 'string' && body.defaultFromNumber.trim().length === 0
        ? null
        : normalizedFrom.e164;
  }

  if (body.defaultSmsFromNumber !== undefined) {
    updatePayload.default_sms_from_number =
      typeof body.defaultSmsFromNumber === 'string' &&
      body.defaultSmsFromNumber.trim().length === 0
        ? null
        : normalizedSms.e164;
  }

  if (body.inboundForwardTo !== undefined) {
    updatePayload.inbound_forward_to =
      typeof body.inboundForwardTo === 'string' && body.inboundForwardTo.trim().length === 0
        ? null
        : normalizedInbound.e164;
  }

  const { error } = await admin
    .from('workspace_dialer_settings')
    .upsert(updatePayload, { onConflict: 'workspace_id' });

  if (error) {
    console.error('[dialer/settings] failed to update workspace settings', error);
    return NextResponse.json(
      { error: 'Failed to update workspace dialer settings' },
      { status: 500 }
    );
  }

  const response = await buildSettingsResponse(
    admin,
    membership.workspaceId,
    membership.role,
    authContext.email,
    request
  );
  return NextResponse.json(response);
}
