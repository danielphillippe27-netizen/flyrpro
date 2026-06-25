import { NextRequest, NextResponse } from 'next/server';
import type { DialerSmsFollowup, DiallerLead } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { sendDialerSms } from '@/lib/dialer/provider';
import { normalizePhoneNumber, phoneMarketFromCountryCode } from '@/lib/dialer/phone';
import { resolveOutboundCallerId } from '@/lib/dialer/caller-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SendLeadSmsPayload = {
  workspaceId?: string;
  body?: string;
  phone?: string;
  name?: string;
};

const MAX_SMS_BODY_LENGTH = 1000;

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeDiallerLeadPhone(lead: DiallerLead) {
  return normalizePhoneNumber(
    cleanText(lead.phone_e164) || lead.phone,
    phoneMarketFromCountryCode(lead.phone_country_code)
  );
}

async function sendFallbackLeadSms(
  request: NextRequest,
  context: Exclude<Awaited<ReturnType<typeof getDialerRequestContext>>, NextResponse>,
  params: {
    leadId: string;
    phone?: string;
    name?: string;
    body: string;
  }
) {
  const normalizedPhone = normalizePhoneNumber(params.phone);
  if (!normalizedPhone.e164) {
    return NextResponse.json({ error: 'This lead does not have a valid SMS number.' }, { status: 400 });
  }

  const fromNumber = resolveOutboundCallerId({
    toNumber: normalizedPhone.e164,
    defaultFromNumber: context.settings.defaultSmsFromNumber!,
    allowMarketOverride: !context.settings.salespersonSmsFromNumber,
  });
  const message = await sendDialerSms(request, {
    from: fromNumber,
    to: normalizedPhone.e164,
    body: params.body,
  });

  return NextResponse.json(
    {
      followup: null,
      warning: null,
      message: {
        provider: message.provider,
        messageId: message.messageId,
        status: message.status,
        to: normalizedPhone.e164,
        from: fromNumber,
        leadId: params.leadId,
        leadName: cleanText(params.name) || null,
      },
    },
    { status: 201 }
  );
}

async function findExistingContact(context: Awaited<ReturnType<typeof getDialerRequestContext>>, lead: DiallerLead) {
  if (context instanceof NextResponse) return null;

  const normalizedPhone = normalizeDiallerLeadPhone(lead);
  const lookups = [
    normalizedPhone.e164 ? { column: 'phone_e164', value: normalizedPhone.e164 } : null,
    cleanText(lead.phone) ? { column: 'phone', value: cleanText(lead.phone) } : null,
    cleanText(lead.email) ? { column: 'email', value: cleanText(lead.email) } : null,
  ].filter((lookup): lookup is { column: string; value: string } => Boolean(lookup));

  for (const lookup of lookups) {
    const { data, error } = await context.admin
      .from('contacts')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq(lookup.column, lookup.value)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return data as Record<string, unknown>;
    if (error && error.code !== 'PGRST116') {
      console.warn('[dialer/lead-sms] contact lookup failed', error);
    }
  }

  return null;
}

async function upsertLeadContact(context: Exclude<Awaited<ReturnType<typeof getDialerRequestContext>>, NextResponse>, lead: DiallerLead) {
  const normalizedPhone = normalizeDiallerLeadPhone(lead);
  const existing = await findExistingContact(context, lead);
  const now = new Date().toISOString();
  const contactPayload = {
    user_id: context.requestUser.id,
    workspace_id: context.workspaceId,
    full_name: cleanText(lead.name) || 'Lead',
    phone: cleanText(lead.phone) || null,
    phone_e164: normalizedPhone.e164,
    phone_country_code: normalizedPhone.countryCode,
    phone_area_code: normalizedPhone.areaCode,
    phone_area_label: normalizedPhone.areaLabel,
    phone_last_validated_at: now,
    phone_validation_error: normalizedPhone.error,
    email: cleanText(lead.email) || null,
    address: '',
    status: 'warm',
    notes: cleanText(lead.notes) || null,
    last_contacted: now,
    updated_at: now,
  };

  const { data, error } = existing?.id
    ? await context.admin
        .from('contacts')
        .update(contactPayload)
        .eq('id', existing.id)
        .select('*')
        .single()
    : await context.admin
        .from('contacts')
        .insert({ ...contactPayload, created_at: now })
        .select('*')
        .single();

  if (error) {
    console.error('[dialer/lead-sms] failed to prepare contact', error);
    return { contact: null, error: 'Could not prepare the contact before sending the text.' };
  }

  return { contact: data as Record<string, unknown>, error: null };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const payload = (await request.json().catch(() => ({}))) as SendLeadSmsPayload;
  const messageBody = cleanText(payload.body);
  const { leadId } = await params;

  if (!messageBody) {
    return NextResponse.json({ error: 'Write a text before sending it.' }, { status: 400 });
  }

  if (messageBody.length > MAX_SMS_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Keep the text under ${MAX_SMS_BODY_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const context = await getDialerRequestContext(request, payload.workspaceId);
  if (context instanceof NextResponse) return context;

  if (!context.settings.defaultSmsFromNumber) {
    return NextResponse.json(
      { error: 'Add an SMS-enabled dialer number before sending texts.' },
      { status: 400 }
    );
  }

  const { data: lead, error: leadError } = await context.admin
    .from('dialler_leads')
    .select('*')
    .eq('id', leadId)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .maybeSingle();

  if (leadError) {
    console.error('[dialer/lead-sms] failed to load lead', leadError);
    return NextResponse.json({ error: 'Failed to load lead.' }, { status: 500 });
  }

  if (!lead) {
    if (payload.phone) {
      try {
        return await sendFallbackLeadSms(request, context, {
          leadId,
          phone: payload.phone,
          name: payload.name,
          body: messageBody,
        });
      } catch (error) {
        console.error('[dialer/lead-sms] failed to send fallback lead text', error);
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Failed to send the text.' },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
  }

  const diallerLead = lead as DiallerLead;
  const normalizedPhone = normalizeDiallerLeadPhone(diallerLead);
  if (!normalizedPhone.e164) {
    return NextResponse.json({ error: 'This lead does not have a valid SMS number.' }, { status: 400 });
  }

  const contactSave = await upsertLeadContact(context, diallerLead);
  if (!contactSave.contact) {
    return NextResponse.json({ error: contactSave.error }, { status: 500 });
  }

  const contactId = typeof contactSave.contact.id === 'string' ? contactSave.contact.id : null;
  if (!contactId) {
    return NextResponse.json({ error: 'Could not prepare the contact before sending the text.' }, { status: 500 });
  }

  try {
    const now = new Date().toISOString();
    const fromNumber = resolveOutboundCallerId({
      toNumber: normalizedPhone.e164,
      defaultFromNumber: context.settings.defaultSmsFromNumber,
      allowMarketOverride: !context.settings.salespersonSmsFromNumber,
    });
    const message = await sendDialerSms(request, {
      from: fromNumber,
      to: normalizedPhone.e164,
      body: messageBody,
    });

    const insertPayload = {
      workspace_id: context.workspaceId,
      call_id: null,
      contact_id: contactId,
      user_id: context.requestUser.id,
      telecom_provider: message.provider,
      provider_message_id: message.messageId,
      twilio_message_sid: message.provider === 'twilio' ? message.messageId : null,
      from_number_e164: fromNumber,
      to_number_e164: normalizedPhone.e164,
      body: messageBody,
      status: message.status,
      sent_at: now,
      status_payload: {
        ...message.raw,
        provider: message.provider,
        source: 'dialler_lead',
        diallerLeadId: diallerLead.id,
      },
    };

    const [{ data: followup, error: insertError }, { error: activityError }] = await Promise.all([
      context.admin.from('dialer_sms_followups').insert(insertPayload).select('*').single(),
      context.admin.from('contact_activities').insert({
        contact_id: contactId,
        type: 'text',
        note: `Dialler text: ${messageBody}`,
        timestamp: now,
      }),
    ]);

    if (activityError) {
      console.warn('[dialer/lead-sms] failed to log contact activity', activityError);
    }

    if (insertError) {
      console.error('[dialer/lead-sms] failed to save text follow-up', insertError);
      return NextResponse.json(
        { followup: null, warning: 'Text sent, but FLYR could not save the text record.' },
        { status: 201 }
      );
    }

    return NextResponse.json({ followup: followup as DialerSmsFollowup }, { status: 201 });
  } catch (error) {
    console.error('[dialer/lead-sms] failed to send text', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send the text.' },
      { status: 500 }
    );
  }
}
