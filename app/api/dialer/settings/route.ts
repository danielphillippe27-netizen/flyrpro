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
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_EMAIL_HANDLE_PATTERN,
  buildFallbackDemoEmailHandle,
  normalizeDemoEmailHandle,
  resolveAvailableDemoEmailHandle,
  type HandleLookupClient,
} from '@/lib/dialer/demo-email-handle';
import {
  getSalespersonDialerSettingsForUser,
  normalizeSalespersonDialerNumber,
  type DialerSalespersonRow,
  type SalespersonDialerSettingsRow,
} from '@/lib/dialer/salesperson-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UpdatePayload = {
  workspaceId?: string;
  enabled?: boolean;
  allowSmsFollowup?: boolean;
  defaultFromNumber?: string | null;
  defaultSmsFromNumber?: string | null;
  inboundForwardTo?: string | null;
  demoEmailHandle?: string | null;
  demoEmailReplyTo?: string | null;
  salesPhoneForwardTo?: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function getErrorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error.toLowerCase();
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error !== 'object') return String(error).toLowerCase();

  return ['code', 'message', 'details', 'hint']
    .map((key) => {
      const value = (error as Record<string, unknown>)[key];
      return typeof value === 'string' ? value : '';
    })
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isSchemaMissingError(error: unknown, columns: string[]): boolean {
  const text = getErrorText(error);
  return (
    columns.some((column) => text.includes(column.toLowerCase())) &&
    (
      text.includes('could not find') ||
      text.includes('does not exist') ||
      text.includes('schema cache') ||
      text.includes('column')
    )
  );
}

function isDemoEmailHandleConflictError(error: unknown): boolean {
  const text = getErrorText(error);
  return (
    text.includes('23505') ||
    text.includes('salespeople_demo_email_handle_lower_idx') ||
    (text.includes('duplicate') && text.includes('demo_email_handle'))
  );
}

function buildSalespersonSettingsResponse(
  salesperson: DialerSalespersonRow | null,
  dialerSettings: SalespersonDialerSettingsRow | null,
  fallbackHandle: string,
  userEmail: string | null
) {
  const demoHandle = salesperson?.demo_email_handle ?? fallbackHandle;
  return {
    id: salesperson?.id ?? null,
    fullName: salesperson?.full_name ?? null,
    email: salesperson?.email ?? userEmail,
    demoEmailHandle: demoHandle,
    demoEmailAddress: `${demoHandle}@${DEMO_EMAIL_DOMAIN}`,
    demoEmailReplyTo: salesperson?.demo_email_reply_to ?? salesperson?.email ?? userEmail,
    demoEmailDomain: DEMO_EMAIL_DOMAIN,
    assignedPhoneNumber: normalizeSalespersonDialerNumber(dialerSettings?.assigned_phone_number),
    phoneForwardTo: normalizeSalespersonDialerNumber(dialerSettings?.inbound_forward_to),
    phoneNumberStatus: dialerSettings?.number_status ?? 'unassigned',
    phoneNumberAssignedAt: dialerSettings?.number_assigned_at ?? null,
  };
}

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
  userId: string,
  userEmail: string | null,
  request: NextRequest
) {
  const founderBypassEnabled = isDialerFounderBypassEmail(userEmail);
  const {
    salesperson,
    settings: salespersonDialerSettings,
  } = await getSalespersonDialerSettingsForUser(admin, {
    userId,
    email: userEmail,
    workspaceId,
  });
  const salespersonFeatureEnabled = Boolean(salesperson?.id);
  const featureEnabled =
    salespersonFeatureEnabled || isDialerEnabledForWorkspace(workspaceId, userEmail);
  const sharedDefaultDialingEnabled =
    salespersonFeatureEnabled || canDialerWorkspaceUseSharedDefault(workspaceId, userEmail);
  const fallbackHandle = salesperson
    ? await resolveAvailableDemoEmailHandle(admin as unknown as HandleLookupClient, salesperson, userEmail)
    : buildFallbackDemoEmailHandle(null, userEmail);
  const salespersonResponse = buildSalespersonSettingsResponse(
    salesperson,
    salespersonDialerSettings,
    fallbackHandle,
    userEmail
  );

  if (!featureEnabled) {
    return {
      workspaceId,
      role,
      canManage: role === 'owner' || role === 'admin',
      featureEnabled: false,
      sharedDefaultDialingEnabled: false,
      offer: null,
      addon: null,
      salesperson: salespersonResponse,
      settings: null,
    };
  }

  const [settings, addon] = await Promise.all([
    getWorkspaceDialerSettings(admin, workspaceId, salespersonDialerSettings),
    getWorkspacePowerDialerAddon(admin, workspaceId),
  ]);
  const offer = getPowerDialerAddonOffer(getRequestBillingCurrency(request));
  const addonStatus = founderBypassEnabled || salespersonFeatureEnabled ? 'active' : addon.status;
  const effectiveSettings =
    founderBypassEnabled || salespersonFeatureEnabled
      ? {
          ...settings,
          dialerAddonActive: true,
          dialerAddonStatus: 'active' as const,
          usesSharedDefaultNumber: !settings.salespersonFromNumber && settings.usesSharedDefaultNumber,
        }
      : settings;

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
    salesperson: salespersonResponse,
    settings: effectiveSettings,
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
    context.requestUser.id,
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

  const hasWorkspaceSettingsUpdate =
    body.enabled !== undefined ||
    body.allowSmsFollowup !== undefined ||
    body.defaultFromNumber !== undefined ||
    body.defaultSmsFromNumber !== undefined ||
    body.inboundForwardTo !== undefined;
  const hasDemoEmailUpdate = body.demoEmailHandle !== undefined || body.demoEmailReplyTo !== undefined;
  const hasSalesPhoneUpdate = body.salesPhoneForwardTo !== undefined;
  const isSalespersonOnlyUpdate =
    (hasDemoEmailUpdate || hasSalesPhoneUpdate) && !hasWorkspaceSettingsUpdate;

  if (!isSalespersonOnlyUpdate && !isDialerEnabledForWorkspace(membership.workspaceId, authContext.email)) {
    return NextResponse.json(
      { error: getDialerWorkspaceAccessError() },
      { status: 403 }
    );
  }

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    if (!isSalespersonOnlyUpdate) {
      return NextResponse.json(
        { error: 'Only workspace owners and admins can manage dialer settings' },
        { status: 403 }
      );
    }
  }

  let salespersonForUpdates: DialerSalespersonRow | null = null;
  if (hasDemoEmailUpdate || hasSalesPhoneUpdate) {
    salespersonForUpdates = (await getSalespersonDialerSettingsForUser(admin, {
      userId: authContext.id,
      email: authContext.email,
      workspaceId: membership.workspaceId,
    })).salesperson;
  }

  if (body.demoEmailHandle !== undefined || body.demoEmailReplyTo !== undefined) {
    const normalizedEmail = authContext.email?.trim().toLowerCase();
    if (!normalizedEmail) {
      return NextResponse.json({ error: 'Sign in with an email before setting a demo sender.' }, { status: 400 });
    }
    if (!salespersonForUpdates?.id) {
      return NextResponse.json({ error: 'Salesperson access is required to set a demo sender.' }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    let requestedDemoEmailHandle: string | null | undefined;
    if (body.demoEmailHandle !== undefined) {
      const handle = normalizeDemoEmailHandle(body.demoEmailHandle);
      if (handle && !DEMO_EMAIL_HANDLE_PATTERN.test(handle)) {
        return NextResponse.json(
          { error: 'Use only letters, numbers, dots, dashes, and underscores for the demo sender.' },
          { status: 400 }
        );
      }
      requestedDemoEmailHandle = handle;
      updates.demo_email_handle = handle;
    }

    if (body.demoEmailReplyTo !== undefined) {
      const replyTo = cleanText(body.demoEmailReplyTo).toLowerCase();
      if (replyTo && !EMAIL_PATTERN.test(replyTo)) {
        return NextResponse.json({ error: 'Reply-to must be a valid email address.' }, { status: 400 });
      }
      updates.demo_email_reply_to = replyTo || null;
    }

    if (requestedDemoEmailHandle) {
      const { data: existingHandleOwner, error: handleLookupError } = await admin
        .from('salespeople')
        .select('id')
        .eq('demo_email_handle', requestedDemoEmailHandle)
        .neq('id', salespersonForUpdates.id)
        .limit(1)
        .maybeSingle();

      if (handleLookupError) {
        console.error('[dialer/settings] failed to check demo email handle availability', handleLookupError);
        const message = isSchemaMissingError(handleLookupError, ['demo_email_handle'])
          ? 'Sales email settings are not ready yet. Run the latest Supabase migration first.'
          : 'Could not check whether that sales email is available.';
        return NextResponse.json({ error: message }, { status: 500 });
      }

      if (existingHandleOwner) {
        return NextResponse.json(
          { error: `${requestedDemoEmailHandle}@${DEMO_EMAIL_DOMAIN} is already in use. Try another sender.` },
          { status: 409 }
        );
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await admin
        .from('salespeople')
        .update(updates)
        .eq('id', salespersonForUpdates.id)
        .eq('status', 'active');

      if (error) {
        console.error('[dialer/settings] failed to update salesperson demo email settings', error);
        if (isDemoEmailHandleConflictError(error)) {
          const handle = requestedDemoEmailHandle || normalizeDemoEmailHandle(body.demoEmailHandle);
          const message = handle
            ? `${handle}@${DEMO_EMAIL_DOMAIN} is already in use. Try another sender.`
            : 'That sales email sender is already in use. Try another sender.';
          return NextResponse.json(
            { error: message },
            { status: 409 }
          );
        }
        if (isSchemaMissingError(error, ['demo_email_handle', 'demo_email_reply_to'])) {
          return NextResponse.json(
            { error: 'Sales email settings are not ready yet. Run the latest Supabase migration first.' },
            { status: 500 }
          );
        }
        return NextResponse.json(
          { error: 'Failed to save demo email settings.' },
          { status: 500 }
        );
      }
    }
  }

  if (body.salesPhoneForwardTo !== undefined) {
    if (!salespersonForUpdates?.id) {
      return NextResponse.json({ error: 'Salesperson access is required to set phone forwarding.' }, { status: 403 });
    }

    const normalizedForwardTo = normalizePhoneNumber(body.salesPhoneForwardTo ?? undefined);
    if (
      typeof body.salesPhoneForwardTo === 'string' &&
      body.salesPhoneForwardTo.trim().length > 0 &&
      (!normalizedForwardTo.isValid || !normalizedForwardTo.e164)
    ) {
      return NextResponse.json(
        { error: normalizedForwardTo.error ?? 'Forwarding phone must be a valid phone number.' },
        { status: 400 }
      );
    }

    const { error } = await admin
      .from('salesperson_dialer_settings')
      .upsert(
        {
          salesperson_id: salespersonForUpdates.id,
          workspace_id: membership.workspaceId,
          inbound_forward_to:
            typeof body.salesPhoneForwardTo === 'string' &&
            body.salesPhoneForwardTo.trim().length === 0
              ? null
              : normalizedForwardTo.e164,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'salesperson_id' }
      );

    if (error) {
      console.error('[dialer/settings] failed to update salesperson phone forwarding', error);
      return NextResponse.json(
        { error: 'Failed to save sales phone forwarding. Run the latest Supabase migration first.' },
        { status: 500 }
      );
    }
  }

  if (!hasWorkspaceSettingsUpdate) {
    const response = await buildSettingsResponse(
      admin,
      membership.workspaceId,
      membership.role,
      authContext.id,
      authContext.email,
      request
    );
    return NextResponse.json(response);
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
    authContext.id,
    authContext.email,
    request
  );
  return NextResponse.json(response);
}
