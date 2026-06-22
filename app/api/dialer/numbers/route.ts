import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { getWorkspacePowerDialerAddon } from '@/app/lib/billing/workspace-addons';
import { getPublicAppUrl } from '@/app/lib/billing/stripe-products';
import {
  getDialerWorkspaceAccessError,
  isDialerEnabledForWorkspace,
} from '@/lib/dialer/feature-gate';
import { provisionDialerPhoneNumber } from '@/lib/dialer/provider';
import { getWorkspaceDialerSettings } from '@/lib/dialer/server';
import { getDialerTelecomProvider } from '@/lib/dialer/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProvisionPayload = {
  workspaceId?: string;
  areaCode?: string;
  countryCode?: string;
};

function getProvisionErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const message = (error as { message: string }).message.trim();
    if (message) return message;
  }

  return 'Failed to provision a dialer number.';
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as ProvisionPayload;
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const membership = await resolveWorkspaceMembershipForUser(
      admin as unknown as MinimalSupabaseClient,
      requestUser.id,
      body.workspaceId ?? request.nextUrl.searchParams.get('workspaceId')
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

    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only workspace owners and admins can provision dialer numbers' },
        { status: 403 }
      );
    }

    const addon = await getWorkspacePowerDialerAddon(admin, membership.workspaceId);
    if (addon.status !== 'active') {
      return NextResponse.json(
        { error: 'Enable the Power Dialer add-on before provisioning a number' },
        { status: 403 }
      );
    }

    const settings = await getWorkspaceDialerSettings(admin, membership.workspaceId);
    if (
      settings.numberStatus === 'active' &&
      (settings.twilioIncomingPhoneNumberSid || settings.providerPhoneNumberId) &&
      settings.dedicatedFromNumber
    ) {
      return NextResponse.json(
        {
          error: 'This workspace already has an assigned dialer number',
          phoneNumber: settings.dedicatedFromNumber,
        },
        { status: 409 }
      );
    }

    const countryCode =
      typeof body.countryCode === 'string' && /^[A-Za-z]{2}$/.test(body.countryCode.trim())
        ? body.countryCode.trim().toUpperCase()
        : 'US';
    const areaCode =
      typeof body.areaCode === 'string' && /^\d{3}$/.test(body.areaCode.trim())
        ? Number.parseInt(body.areaCode.trim(), 10)
        : undefined;

    const appUrl = getPublicAppUrl(request);
    if (!appUrl) {
      return NextResponse.json(
        {
          error:
            'Set APP_BASE_URL or NEXT_PUBLIC_APP_URL to a public HTTPS app URL before claiming a dialer number.',
        },
        { status: 400 }
      );
    }

    const activeProvider = getDialerTelecomProvider();
    const voicePath = activeProvider === 'telnyx' ? '/api/telnyx/voice/incoming' : '/api/twilio/voice/incoming';
    const smsPath = activeProvider === 'telnyx' ? '/api/telnyx/messaging/incoming' : '/api/twilio/messaging/incoming';
    const statusPath = activeProvider === 'telnyx' ? '/api/telnyx/voice/status' : '/api/twilio/voice/incoming-status';
    const purchasedNumber = await provisionDialerPhoneNumber({
      countryCode,
      areaCode,
      friendlyName: `FLYR ${membership.workspaceId}`,
      voiceUrl: new URL(voicePath, appUrl).toString(),
      smsUrl: new URL(smsPath, appUrl).toString(),
      statusCallback: new URL(statusPath, appUrl).toString(),
    });

    const now = new Date().toISOString();
    const { error } = await admin
      .from('workspace_dialer_settings')
      .upsert(
        {
          workspace_id: membership.workspaceId,
          default_from_number: purchasedNumber.phoneNumber,
          default_sms_from_number: purchasedNumber.phoneNumber,
          telecom_provider: purchasedNumber.provider,
          twilio_incoming_phone_number_sid: purchasedNumber.twilioIncomingPhoneNumberSid,
          provider_phone_number_id: purchasedNumber.providerPhoneNumberId,
          provider_number_order_id: purchasedNumber.providerNumberOrderId,
          number_status: 'active',
          number_assigned_at: now,
          provisioning_metadata: {
            countryCode,
            areaCode: areaCode ?? null,
            locality: purchasedNumber.locality,
            region: purchasedNumber.region,
            provider: purchasedNumber.provider,
            providerMetadata: purchasedNumber.metadata,
          },
          updated_at: now,
        },
        { onConflict: 'workspace_id' }
      );

    if (error) {
      console.error('[dialer/numbers] failed to save workspace number assignment', error);
      return NextResponse.json(
        {
          error:
            'The dialer number was purchased, but FLYR failed to save the workspace assignment. Please update the workspace dialer settings manually.',
          phoneNumber: purchasedNumber.phoneNumber,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      workspaceId: membership.workspaceId,
      phoneNumber: purchasedNumber.phoneNumber,
      phoneNumberSid: purchasedNumber.providerPhoneNumberId,
      provider: purchasedNumber.provider,
      countryCode,
      areaCode: areaCode ?? null,
    });
  } catch (error) {
    console.error('[dialer/numbers] failed to provision workspace number', error);
    return NextResponse.json(
      { error: getProvisionErrorMessage(error) },
      { status: 500 }
    );
  }
}
