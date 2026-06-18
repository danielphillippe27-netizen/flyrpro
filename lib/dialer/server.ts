import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceMembershipForUser, type MinimalSupabaseClient, type WorkspaceRole } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getTwilioAccountSid,
  getTwilioApiKeySecret,
  getTwilioApiKeySid,
  getTwilioAuthToken,
  getTwilioDefaultFromNumber,
  getTwilioDefaultSmsFromNumber,
  getTwilioTwiMLAppSid,
} from '@/lib/dialer/env';
import {
  getDialerWorkspaceAccessError,
  isDialerFounderBypassEmail,
  isDialerEnabledForWorkspace,
} from '@/lib/dialer/feature-gate';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import {
  getSalespersonDialerSettingsForUser,
  type DialerSalespersonRow,
} from '@/lib/dialer/salesperson-settings';
import { getWorkspacePowerDialerAddon } from '@/app/lib/billing/workspace-addons';
import type {
  WorkspaceBillingAddonStatus,
  WorkspaceDialerNumberStatus,
} from '@/types/database';

export type DialerRequestContext = {
  admin: ReturnType<typeof createAdminClient>;
  requestUser: { id: string; email: string | null };
  workspaceId: string;
  role: WorkspaceRole | null;
  salesperson: DialerSalespersonRow | null;
  settings: {
    enabled: boolean;
    defaultFromNumber: string;
    defaultSmsFromNumber: string | null;
    dedicatedFromNumber: string | null;
    dedicatedSmsFromNumber: string | null;
    salespersonFromNumber: string | null;
    salespersonSmsFromNumber: string | null;
    salespersonInboundForwardTo: string | null;
    inboundForwardTo: string | null;
    allowSmsFollowup: boolean;
    dialerAddonActive: boolean;
    dialerAddonStatus: WorkspaceBillingAddonStatus;
    twilioIncomingPhoneNumberSid: string | null;
    numberStatus: WorkspaceDialerNumberStatus;
    numberAssignedAt: string | null;
    usesSharedDefaultNumber: boolean;
  };
};

type TwilioWebhookValidationResult = {
  isValid: boolean;
  response?: NextResponse;
  params: Record<string, string>;
};

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/\/$/, '');
  if (!cleaned) return null;
  const url = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function buildPublicTwilioWebhookUrl(request: NextRequest, path: string): URL {
  const baseUrl =
    normalizeBaseUrl(process.env.TWILIO_WEBHOOK_BASE_URL) ||
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizeBaseUrl(process.env.APP_BASE_URL) ||
    normalizeBaseUrl(process.env.VERCEL_URL) ||
    normalizeBaseUrl(request.nextUrl.origin) ||
    'https://flyrpro.app';

  return new URL(path, baseUrl);
}

export async function getDialerRequestContext(
  request: NextRequest,
  requestedWorkspaceId?: string | null
): Promise<DialerRequestContext | NextResponse> {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId ?? undefined
  );

  if (!membership.workspaceId) {
    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 403 }
    );
  }

  const salespersonContext = await getSalespersonDialerSettingsForUser(admin, {
    userId: requestUser.id,
    email: requestUser.email,
    workspaceId: membership.workspaceId,
  });
  const founderBypassEnabled = isDialerFounderBypassEmail(requestUser.email);
  const salespersonFeatureEnabled = Boolean(salespersonContext.salesperson?.id);

  if (
    !salespersonFeatureEnabled &&
    !isDialerEnabledForWorkspace(membership.workspaceId, requestUser.email)
  ) {
    return NextResponse.json(
      { error: getDialerWorkspaceAccessError() },
      { status: 403 }
    );
  }

  const settings = await getWorkspaceDialerSettings(
    admin,
    membership.workspaceId,
    salespersonContext.settings
  );
  if (!settings.dialerAddonActive && !founderBypassEnabled) {
    return NextResponse.json(
      { error: 'Power Dialer add-on is not active for this workspace' },
      { status: 403 }
    );
  }

  if (!settings.enabled) {
    return NextResponse.json({ error: 'Dialer is disabled for this workspace' }, { status: 403 });
  }

  return {
    admin,
    requestUser,
    workspaceId: membership.workspaceId,
    role: membership.role,
    salesperson: salespersonContext.salesperson,
    settings: founderBypassEnabled
      ? {
          ...settings,
          dialerAddonActive: true,
          dialerAddonStatus: 'active',
          usesSharedDefaultNumber: true,
        }
      : settings,
  };
}

export async function getWorkspaceDialerSettings(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  salespersonSettings?: {
    assigned_phone_number?: string | null;
    default_sms_from_number?: string | null;
    inbound_forward_to?: string | null;
  } | null
): Promise<DialerRequestContext['settings']> {
  const envDefaultFromNumber = getTwilioDefaultFromNumber();
  const envDefaultSmsFromNumber = getTwilioDefaultSmsFromNumber();

  const { data } = await admin
    .from('workspace_dialer_settings')
    .select(
      'enabled, default_from_number, default_sms_from_number, inbound_forward_to, allow_sms_followup, twilio_incoming_phone_number_sid, number_status, number_assigned_at'
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const addon = await getWorkspacePowerDialerAddon(admin, workspaceId);

  const workspaceFromNumber = normalizePhoneNumber(data?.default_from_number).e164;
  const workspaceSmsFromNumber = normalizePhoneNumber(data?.default_sms_from_number).e164;
  const workspaceInboundForwardTo = normalizePhoneNumber(data?.inbound_forward_to).e164;
  const salespersonFromNumber = normalizePhoneNumber(salespersonSettings?.assigned_phone_number).e164;
  const salespersonSmsFromNumber =
    normalizePhoneNumber(salespersonSettings?.default_sms_from_number).e164 || salespersonFromNumber;
  const salespersonInboundForwardTo =
    normalizePhoneNumber(salespersonSettings?.inbound_forward_to).e164;

  return {
    enabled: data?.enabled ?? true,
    defaultFromNumber: salespersonFromNumber || workspaceFromNumber || envDefaultFromNumber,
    defaultSmsFromNumber:
      salespersonSmsFromNumber || workspaceSmsFromNumber || envDefaultSmsFromNumber,
    dedicatedFromNumber: workspaceFromNumber,
    dedicatedSmsFromNumber: workspaceSmsFromNumber,
    salespersonFromNumber,
    salespersonSmsFromNumber,
    salespersonInboundForwardTo,
    inboundForwardTo: salespersonInboundForwardTo || workspaceInboundForwardTo,
    allowSmsFollowup: Boolean(data?.allow_sms_followup),
    dialerAddonActive: addon.status === 'active',
    dialerAddonStatus: addon.status,
    twilioIncomingPhoneNumberSid: data?.twilio_incoming_phone_number_sid ?? null,
    numberStatus:
      (data?.number_status as WorkspaceDialerNumberStatus | undefined) ?? 'unassigned',
    numberAssignedAt: data?.number_assigned_at ?? null,
    usesSharedDefaultNumber: !workspaceFromNumber,
  };
}

export function buildDialerIdentity(workspaceId: string, userId: string, tabId: string): string {
  const safeTabId = tabId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'web';
  return `dialer:${workspaceId}:${userId}:${safeTabId}`;
}

export function createTwilioVoiceToken(identity: string): { token: string; expiresAt: string } {
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const ttlSeconds = 60 * 55;

  const token = new AccessToken(
    getTwilioAccountSid(),
    getTwilioApiKeySid(),
    getTwilioApiKeySecret(),
    { identity, ttl: ttlSeconds }
  );
  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: getTwilioTwiMLAppSid(),
      incomingAllow: false,
    })
  );

  return {
    token: token.toJwt(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

export async function validateTwilioWebhookRequest(request: NextRequest): Promise<TwilioWebhookValidationResult> {
  const formData = await request.formData();
  const params = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, String(value)])
  );
  const signature = request.headers.get('x-twilio-signature');

  if (!signature) {
    return {
      isValid: false,
      response: NextResponse.json({ error: 'Missing Twilio signature' }, { status: 401 }),
      params,
    };
  }

  const isValid = twilio.validateRequest(getTwilioAuthToken(), signature, request.url, params);
  return {
    isValid,
    response: isValid ? undefined : NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 401 }),
    params,
  };
}

export function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
