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
  isDialerEnabledForWorkspace,
} from '@/lib/dialer/feature-gate';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
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
  settings: {
    enabled: boolean;
    defaultFromNumber: string;
    defaultSmsFromNumber: string | null;
    dedicatedFromNumber: string | null;
    dedicatedSmsFromNumber: string | null;
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

  if (!isDialerEnabledForWorkspace(membership.workspaceId)) {
    return NextResponse.json(
      { error: getDialerWorkspaceAccessError() },
      { status: 403 }
    );
  }

  const settings = await getWorkspaceDialerSettings(admin, membership.workspaceId);
  if (!settings.dialerAddonActive) {
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
    settings,
  };
}

export async function getWorkspaceDialerSettings(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
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

  return {
    enabled: data?.enabled ?? true,
    defaultFromNumber: workspaceFromNumber || envDefaultFromNumber,
    defaultSmsFromNumber: workspaceSmsFromNumber || envDefaultSmsFromNumber,
    dedicatedFromNumber: workspaceFromNumber,
    dedicatedSmsFromNumber: workspaceSmsFromNumber,
    inboundForwardTo: workspaceInboundForwardTo,
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
