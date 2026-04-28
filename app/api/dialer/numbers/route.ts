import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { getWorkspacePowerDialerAddon } from '@/app/lib/billing/workspace-addons';
import { getPublicAppUrl } from '@/app/lib/billing/stripe-products';
import {
  getTwilioAccountSid,
  getTwilioAuthToken,
} from '@/lib/dialer/env';
import {
  getDialerWorkspaceAccessError,
  isDialerEnabledForWorkspace,
} from '@/lib/dialer/feature-gate';
import { getWorkspaceDialerSettings } from '@/lib/dialer/server';
import type { LocalListInstanceOptions } from 'twilio/lib/rest/api/v2010/account/availablePhoneNumberCountry/local';

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
    if (message) {
      return message;
    }
  }

  return 'Failed to provision a Twilio number.';
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
      settings.twilioIncomingPhoneNumberSid &&
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

    const client = twilio(getTwilioAccountSid(), getTwilioAuthToken());
    const search: LocalListInstanceOptions =
      areaCode && ['US', 'CA'].includes(countryCode)
        ? { areaCode, limit: 1, smsEnabled: true, voiceEnabled: true }
        : { limit: 1, smsEnabled: true, voiceEnabled: true };

    const candidates = await client.availablePhoneNumbers(countryCode).local.list(search);
    const candidate = candidates[0];
    if (!candidate?.phoneNumber) {
      return NextResponse.json(
        { error: 'No available Twilio local numbers matched that search' },
        { status: 404 }
      );
    }

    const appUrl = getPublicAppUrl(request);
    if (!appUrl) {
      return NextResponse.json(
        {
          error:
            'Set APP_BASE_URL or NEXT_PUBLIC_APP_URL to a public HTTPS app URL before claiming a Twilio number.',
        },
        { status: 400 }
      );
    }
    const voiceUrl = new URL('/api/twilio/voice/incoming', appUrl).toString();
    const statusCallback = new URL('/api/twilio/voice/incoming-status', appUrl).toString();

    const purchasedNumber = await client.incomingPhoneNumbers.create({
      phoneNumber: candidate.phoneNumber,
      friendlyName: `FLYR ${membership.workspaceId}`,
      voiceUrl,
      voiceMethod: 'POST',
      statusCallback,
      statusCallbackMethod: 'POST',
    });

    const now = new Date().toISOString();
    const { error } = await admin
      .from('workspace_dialer_settings')
      .upsert(
        {
          workspace_id: membership.workspaceId,
          default_from_number: purchasedNumber.phoneNumber,
          default_sms_from_number: purchasedNumber.phoneNumber,
          twilio_incoming_phone_number_sid: purchasedNumber.sid,
          number_status: 'active',
          number_assigned_at: now,
          provisioning_metadata: {
            countryCode,
            areaCode: areaCode ?? null,
            locality: candidate.locality ?? null,
            region: candidate.region ?? null,
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
            'The Twilio number was purchased, but FLYR failed to save the workspace assignment. Please update the workspace dialer settings manually.',
          phoneNumber: purchasedNumber.phoneNumber,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      workspaceId: membership.workspaceId,
      phoneNumber: purchasedNumber.phoneNumber,
      phoneNumberSid: purchasedNumber.sid,
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
