import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import type { DialerCall, DialerSmsFollowup } from '@/types/database';
import { buildPublicTwilioWebhookUrl, getDialerRequestContext } from '@/lib/dialer/server';
import { getTwilioAccountSid, getTwilioAuthToken } from '@/lib/dialer/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SendSmsPayload = {
  workspaceId?: string;
  body?: string;
};

const MAX_SMS_BODY_LENGTH = 1000;

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
      { error: 'Add a Twilio SMS-enabled number before sending follow-up texts' },
      { status: 400 }
    );
  }

  if (!call.to_number_e164) {
    return NextResponse.json({ error: 'This lead does not have a valid SMS number yet' }, { status: 400 });
  }

  try {
    const client = twilio(getTwilioAccountSid(), getTwilioAuthToken());
    const statusCallback = buildPublicTwilioWebhookUrl(request, '/api/twilio/messaging/status');
    const now = new Date().toISOString();

    const message = await client.messages.create({
      from: context.settings.defaultSmsFromNumber,
      to: call.to_number_e164,
      body: messageBody,
      statusCallback: statusCallback.toString(),
    });

    const insertPayload = {
      workspace_id: context.workspaceId,
      call_id: call.id,
      contact_id: call.contact_id,
      user_id: context.requestUser.id,
      twilio_message_sid: message.sid,
      from_number_e164: context.settings.defaultSmsFromNumber,
      to_number_e164: call.to_number_e164,
      body: messageBody,
      status: message.status ?? 'queued',
      sent_at: now,
      status_payload: {
        sid: message.sid,
        status: message.status ?? 'queued',
      },
    };

    const [{ data: followup, error: insertError }, { error: activityError }, { error: contactError }] = await Promise.all([
      context.admin.from('dialer_sms_followups').insert(insertPayload).select('*').single(),
      context.admin.from('contact_activities').insert({
        contact_id: call.contact_id,
        type: 'text',
        note: `Dialer SMS follow-up: ${messageBody}`,
        timestamp: now,
      }),
      context.admin.from('contacts').update({ last_contacted: now, updated_at: now }).eq('id', call.contact_id),
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
