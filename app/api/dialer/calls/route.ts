import { NextRequest, NextResponse } from 'next/server';
import type { Contact, DialerCall, DialerSessionLead } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { getDialerTelecomProvider } from '@/lib/dialer/env';
import { resolveOutboundCallerId } from '@/lib/dialer/caller-id';
import { normalizePhoneNumber, phoneMarketFromCountryCode } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateCallPayload = {
  workspaceId?: string;
  sessionId?: string;
  sessionLeadId?: string;
  contactId?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as CreateCallPayload;

  if (!body.sessionId || !body.sessionLeadId || !body.contactId) {
    return NextResponse.json(
      { error: 'sessionId, sessionLeadId, and contactId are required' },
      { status: 400 }
    );
  }

  const context = await getDialerRequestContext(request, body.workspaceId);
  if (context instanceof NextResponse) {
    return context;
  }

  const [{ data: lead, error: leadError }, { data: contact, error: contactError }] = await Promise.all([
    context.admin
      .from('dialer_session_leads')
      .select('*')
      .eq('id', body.sessionLeadId)
      .eq('session_id', body.sessionId)
      .eq('workspace_id', context.workspaceId)
      .maybeSingle(),
    context.admin
      .from('contacts')
      .select('*')
      .eq('id', body.contactId)
      .eq('workspace_id', context.workspaceId)
      .maybeSingle(),
  ]);

  if (leadError || contactError) {
    console.error('[dialer/calls] failed to load lead/contact', { leadError, contactError });
    return NextResponse.json({ error: 'Failed to load lead details' }, { status: 500 });
  }

  if (!lead || !contact) {
    return NextResponse.json({ error: 'Lead not found in this workspace' }, { status: 404 });
  }

  const activeContact = contact as Contact;
  const normalized = normalizePhoneNumber(
    (activeContact.phone_e164 ?? '').trim() || activeContact.phone,
    phoneMarketFromCountryCode(activeContact.phone_country_code)
  );
  const now = new Date().toISOString();

  await context.admin
    .from('contacts')
    .update({
      phone_e164: normalized.e164,
      phone_country_code: normalized.countryCode,
      phone_area_code: normalized.areaCode,
      phone_area_label: normalized.areaLabel,
      phone_last_validated_at: now,
      phone_validation_error: normalized.error,
      updated_at: now,
    })
    .eq('id', contact.id);

  if (!normalized.isValid || !normalized.e164) {
    await context.admin
      .from('dialer_session_leads')
      .update({
        status: 'invalid',
        skip_reason: normalized.error,
        completed_at: now,
        updated_at: now,
      })
      .eq('id', lead.id);

    return NextResponse.json(
      { error: normalized.error ?? 'Phone number is invalid' },
      { status: 400 }
    );
  }

  const { data: existingCall, error: existingCallError } = await context.admin
    .from('dialer_calls')
    .select('*')
    .eq('session_lead_id', body.sessionLeadId)
    .in('status', ['pending', 'initiated', 'ringing', 'in-progress', 'answered'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingCallError) {
    console.error('[dialer/calls] failed to load active call', existingCallError);
    return NextResponse.json({ error: 'Failed to inspect active call state' }, { status: 500 });
  }

  if (existingCall) {
    return NextResponse.json({ call: existingCall as DialerCall, contact });
  }

  const callRequestId = crypto.randomUUID();
  const telecomProvider = getDialerTelecomProvider();
  const fromNumber = resolveOutboundCallerId({
    toNumber: normalized.e164,
    defaultFromNumber: context.settings.defaultFromNumber,
    allowMarketOverride: !context.settings.salespersonFromNumber,
  });
  const { data: call, error: callError } = await context.admin
    .from('dialer_calls')
    .insert({
      workspace_id: context.workspaceId,
      session_id: body.sessionId,
      session_lead_id: body.sessionLeadId,
      contact_id: body.contactId,
      user_id: context.requestUser.id,
      call_request_id: callRequestId,
      telecom_provider: telecomProvider,
      to_number_raw: activeContact.phone ?? null,
      to_number_e164: normalized.e164,
      from_number_e164: fromNumber,
      status: 'pending',
      direction: 'outbound',
      status_payload: {
        destinationCountryCode: normalized.countryCode,
        destinationAreaCode: normalized.areaCode,
        destinationAreaLabel: normalized.areaLabel,
      },
    })
    .select('*')
    .single();

  if (callError || !call) {
    console.error('[dialer/calls] failed to create call', callError);
    return NextResponse.json({ error: 'Failed to start outbound call' }, { status: 500 });
  }

  const activeCall = call as DialerCall;

  await context.admin
    .from('dialer_session_leads')
    .update({
      status: 'calling',
      last_call_id: activeCall.id,
      attempt_count: ((lead as DialerSessionLead).attempt_count ?? 0) + 1,
      updated_at: now,
    })
    .eq('id', lead.id);

  return NextResponse.json({ call: activeCall, contact });
}
