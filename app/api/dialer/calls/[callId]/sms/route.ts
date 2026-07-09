import { NextRequest, NextResponse } from 'next/server';
import type { DialerCall, DialerSmsFollowup } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { sendDialerSms } from '@/lib/dialer/provider';
import { resolveOutboundCallerId } from '@/lib/dialer/caller-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SendSmsPayload = {
  workspaceId?: string;
  body?: string;
};

const MAX_SMS_BODY_LENGTH = 1000;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getPayloadText(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object') return '';
  return cleanText((payload as Record<string, unknown>)[key]);
}

async function ensureContactForCallSms(params: {
  context: Exclude<Awaited<ReturnType<typeof getDialerRequestContext>>, NextResponse>;
  call: DialerCall;
  now: string;
}): Promise<string | null> {
  const existingContactId = cleanText(params.call.contact_id);
  if (existingContactId) return existingContactId;

  const payload = params.call.status_payload;
  const name = getPayloadText(payload, 'diallerLeadName') || 'Lead';
  const phone = getPayloadText(payload, 'diallerLeadPhone') || cleanText(params.call.to_number_raw);
  const email = getPayloadText(payload, 'diallerLeadEmail') || null;

  const { data, error } = await params.context.admin
    .from('contacts')
    .insert({
      user_id: params.context.requestUser.id,
      workspace_id: params.context.workspaceId,
      full_name: name,
      phone: phone || null,
      email,
      address: '',
      status: 'warm',
      last_contacted: params.now,
      created_at: params.now,
      updated_at: params.now,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[dialer/sms] failed to create contact for SMS follow-up', error);
    return null;
  }

  const contactId = cleanText((data as { id?: unknown } | null)?.id);
  if (!contactId) return null;

  await Promise.all([
    params.context.admin.from('dialer_calls').update({ contact_id: contactId, updated_at: params.now }).eq('id', params.call.id),
    params.context.admin.from('dialer_session_leads').update({ contact_id: contactId, updated_at: params.now }).eq('id', params.call.session_lead_id),
  ]);

  return contactId;
}

async function loadAuthorizedCall(
  request: NextRequest,
  workspaceId: string | undefined,
  callId: string
) {
  const context = await getDialerRequestContext(request, workspaceId);
  if (context instanceof NextResponse) {
    return context;
  }

  const { data: call, error } = await context.admin
    .from('dialer_calls')
    .select('*')
    .eq('id', callId)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .maybeSingle();

  if (error) {
    console.error('[dialer/sms] failed to load call', error);
    return NextResponse.json({ error: 'Failed to load call details' }, { status: 500 });
  }

  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  return { context, call: call as DialerCall };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const { callId } = await params;
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
  const auth = await loadAuthorizedCall(request, workspaceId, callId);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const { context } = auth;
  const { data, error } = await context.admin
    .from('dialer_sms_followups')
    .select('*')
    .eq('call_id', callId)
    .eq('workspace_id', context.workspaceId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[dialer/sms] failed to load follow-up texts', error);
    return NextResponse.json({ error: 'Failed to load follow-up texts' }, { status: 500 });
  }

  return NextResponse.json({ followups: (data ?? []) as DialerSmsFollowup[] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const body = (await request.json().catch(() => ({}))) as SendSmsPayload;
  const messageBody = body.body?.trim() ?? '';
  const { callId } = await params;

  if (!messageBody) {
    return NextResponse.json({ error: 'Write a follow-up text before sending it' }, { status: 400 });
  }

  if (messageBody.length > MAX_SMS_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Keep the follow-up text under ${MAX_SMS_BODY_LENGTH} characters` },
      { status: 400 }
    );
  }

  const auth = await loadAuthorizedCall(request, body.workspaceId, callId);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { context, call } = auth;
  if (!context.settings.allowSmsFollowup) {
    return NextResponse.json({ error: 'SMS follow-up is disabled for this workspace' }, { status: 403 });
  }

  if (!context.settings.defaultSmsFromNumber) {
    return NextResponse.json(
      { error: 'Add an SMS-enabled dialer number before sending follow-up texts' },
      { status: 400 }
    );
  }

  if (!call.to_number_e164) {
    return NextResponse.json({ error: 'This lead does not have a valid SMS number yet' }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const salesLeadId = cleanText((call as { sales_lead_id?: unknown }).sales_lead_id);
    const contactId = salesLeadId ? cleanText(call.contact_id) || null : await ensureContactForCallSms({ context, call, now });
    if (!contactId && !salesLeadId) {
      return NextResponse.json({ error: 'Could not save this lead before sending the text.' }, { status: 500 });
    }

    const fromNumber = resolveOutboundCallerId({
      toNumber: call.to_number_e164,
      defaultFromNumber: context.settings.defaultSmsFromNumber,
      allowMarketOverride: !context.settings.salespersonSmsFromNumber,
    });
    const message = await sendDialerSms(request, {
      from: fromNumber,
      to: call.to_number_e164,
      body: messageBody,
    });

    const insertPayload = {
      workspace_id: context.workspaceId,
      call_id: call.id,
      contact_id: contactId,
      sales_lead_id: salesLeadId || null,
      user_id: context.requestUser.id,
      telecom_provider: message.provider,
      provider_message_id: message.messageId,
      twilio_message_sid: message.provider === 'twilio' ? message.messageId : null,
      from_number_e164: fromNumber,
      to_number_e164: call.to_number_e164,
      body: messageBody,
      status: message.status,
      sent_at: now,
      status_payload: {
        ...message.raw,
        provider: message.provider,
      },
    };

    const [{ data: followup, error: insertError }, { error: activityError }, { error: contactError }] = await Promise.all([
      context.admin.from('dialer_sms_followups').insert(insertPayload).select('*').single(),
      contactId
        ? context.admin.from('contact_activities').insert({
            contact_id: contactId,
            type: 'text',
            note: `Dialer SMS follow-up: ${messageBody}`,
            timestamp: now,
          })
        : context.admin.from('sales_activities').insert({
            workspace_id: context.workspaceId,
            sales_lead_id: salesLeadId,
            actor_user_id: context.requestUser.id,
            activity_type: 'text',
            note: `Dialer SMS follow-up: ${messageBody}`,
            occurred_at: now,
          }),
      contactId
        ? context.admin.from('contacts').update({ last_contacted: now, updated_at: now }).eq('id', contactId)
        : context.admin.from('sales_leads').update({ last_attempted_at: now, called_at: now, updated_at: now }).eq('id', salesLeadId),
    ]);

    if (insertError) {
      console.error('[dialer/sms] failed to save follow-up text', insertError);
      return NextResponse.json(
        { followup: null, warning: 'Text sent, but FLYR could not save the follow-up record.' },
        { status: 201 }
      );
    }

    if (activityError) {
      console.warn('[dialer/sms] failed to log contact activity', activityError);
    }

    if (contactError) {
      console.warn('[dialer/sms] failed to update contact last_contacted', contactError);
    }

    return NextResponse.json({ followup: followup as DialerSmsFollowup }, { status: 201 });
  } catch (error) {
    console.error('[dialer/sms] failed to send follow-up text', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to send the follow-up text',
      },
      { status: 500 }
    );
  }
}
