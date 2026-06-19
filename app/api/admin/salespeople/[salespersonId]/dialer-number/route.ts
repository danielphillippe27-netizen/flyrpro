import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import type { LocalListInstanceOptions } from 'twilio/lib/rest/api/v2010/account/availablePhoneNumberCountry/local';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { getPublicAppUrl } from '@/app/lib/billing/stripe-products';
import {
  getTwilioAccountSid,
  getTwilioAuthToken,
} from '@/lib/dialer/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProvisionPayload = {
  areaCode?: string;
  countryCode?: string;
};

type SalespersonRow = {
  id: string;
  full_name: string;
  workspace_id: string | null;
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

  return 'Failed to provision a Twilio number.';
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ salespersonId: string }> }
) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { salespersonId } = await context.params;
    if (!salespersonId) {
      return NextResponse.json({ error: 'Salesperson ID is required.' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as ProvisionPayload;
    const { data: salesperson, error: salespersonError } = await auth.admin
      .from('salespeople')
      .select('id, full_name, workspace_id')
      .eq('id', salespersonId)
      .maybeSingle();

    if (salespersonError) {
      return NextResponse.json({ error: salespersonError.message }, { status: 500 });
    }

    const row = salesperson as SalespersonRow | null;
    if (!row) {
      return NextResponse.json({ error: 'Salesperson not found.' }, { status: 404 });
    }
    if (!row.workspace_id) {
      return NextResponse.json(
        { error: 'This salesperson is not attached to the shared sales workspace yet.' },
        { status: 400 }
      );
    }

    const { data: existingSettings } = await auth.admin
      .from('salesperson_dialer_settings')
      .select('assigned_phone_number, twilio_incoming_phone_number_sid, number_status')
      .eq('salesperson_id', row.id)
      .maybeSingle();

    if (
      existingSettings?.number_status === 'active' &&
      existingSettings?.assigned_phone_number &&
      existingSettings?.twilio_incoming_phone_number_sid
    ) {
      return NextResponse.json(
        {
          error: 'This salesperson already has an assigned dialer number.',
          phoneNumber: existingSettings.assigned_phone_number,
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
        { error: 'No available Twilio local numbers matched that search.' },
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

    const purchasedNumber = await client.incomingPhoneNumbers.create({
      phoneNumber: candidate.phoneNumber,
      friendlyName: `FLYR ${row.full_name || row.id}`,
      voiceUrl: new URL('/api/twilio/voice/incoming', appUrl).toString(),
      voiceMethod: 'POST',
      smsUrl: new URL('/api/twilio/messaging/incoming', appUrl).toString(),
      smsMethod: 'POST',
      statusCallback: new URL('/api/twilio/voice/incoming-status', appUrl).toString(),
      statusCallbackMethod: 'POST',
    });

    const now = new Date().toISOString();
    const { data: settings, error: saveError } = await auth.admin
      .from('salesperson_dialer_settings')
      .upsert(
        {
          salesperson_id: row.id,
          workspace_id: row.workspace_id,
          assigned_phone_number: purchasedNumber.phoneNumber,
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
        { onConflict: 'salesperson_id' }
      )
      .select('*')
      .single();

    if (saveError) {
      console.error('[admin/salespeople/dialer-number] failed to save assignment', saveError);
      return NextResponse.json(
        {
          error:
            'The Twilio number was purchased, but FLYR failed to save the salesperson assignment.',
          phoneNumber: purchasedNumber.phoneNumber,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      salespersonId: row.id,
      workspaceId: row.workspace_id,
      phoneNumber: purchasedNumber.phoneNumber,
      phoneNumberSid: purchasedNumber.sid,
      countryCode,
      areaCode: areaCode ?? null,
      settings,
    });
  } catch (error) {
    console.error('[admin/salespeople/dialer-number] failed to provision number', error);
    return NextResponse.json(
      { error: getProvisionErrorMessage(error) },
      { status: 500 }
    );
  }
}
