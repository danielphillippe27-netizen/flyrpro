import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { getPublicAppUrl } from '@/app/lib/billing/stripe-products';
import { getDialerTelecomProvider } from '@/lib/dialer/env';
import { provisionDialerPhoneNumber } from '@/lib/dialer/provider';

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

  return 'Failed to provision a dialer number.';
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
      .select('assigned_phone_number, twilio_incoming_phone_number_sid, provider_phone_number_id, number_status')
      .eq('salesperson_id', row.id)
      .maybeSingle();

    if (
      existingSettings?.number_status === 'active' &&
      existingSettings?.assigned_phone_number &&
      (existingSettings?.twilio_incoming_phone_number_sid || existingSettings?.provider_phone_number_id)
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
      friendlyName: `FLYR ${row.full_name || row.id}`,
      voiceUrl: new URL(voicePath, appUrl).toString(),
      smsUrl: new URL(smsPath, appUrl).toString(),
      statusCallback: new URL(statusPath, appUrl).toString(),
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
        { onConflict: 'salesperson_id' }
      )
      .select('*')
      .single();

    if (saveError) {
      console.error('[admin/salespeople/dialer-number] failed to save assignment', saveError);
      return NextResponse.json(
        {
          error:
            'The dialer number was purchased, but FLYR failed to save the salesperson assignment.',
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
      phoneNumberSid: purchasedNumber.providerPhoneNumberId,
      provider: purchasedNumber.provider,
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
