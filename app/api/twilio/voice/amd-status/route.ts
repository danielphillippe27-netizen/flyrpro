import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { validateTwilioWebhookRequest } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isMachineAnswer(answeredBy: string | null): boolean {
  return answeredBy?.startsWith('machine') ?? false;
}

export async function POST(request: NextRequest) {
  const validation = await validateTwilioWebhookRequest(request);
  if (!validation.isValid) {
    return validation.response!;
  }

  const callRequestId =
    request.nextUrl.searchParams.get('callRequestId') ??
    validation.params.call_request_id ??
    validation.params.callRequestId ??
    null;
  const callSid = validation.params.CallSid ?? null;

  if (!callRequestId && !callSid) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  let lookup = admin.from('dialer_calls').select('*');
  if (callRequestId) {
    lookup = lookup.eq('call_request_id', callRequestId);
  } else if (callSid) {
    lookup = lookup.eq('twilio_call_sid', callSid);
  }

  const { data: call, error: callError } = await lookup.maybeSingle();
  if (callError) {
    console.error('[twilio/amd-status] failed to load call', callError);
    return NextResponse.json({ ok: true });
  }

  if (!call) {
    return NextResponse.json({ ok: true });
  }

  const now = new Date().toISOString();
  const answeredBy = validation.params.AnsweredBy ?? null;
  const nextPayload = {
    ...(typeof call.status_payload === 'object' && call.status_payload ? call.status_payload : {}),
    amd: {
      answeredBy,
      machineDetectionDurationMs: Number(validation.params.MachineDetectionDuration ?? 0) || null,
      isMachine: isMachineAnswer(answeredBy),
      receivedAt: now,
      lastWebhook: validation.params,
    },
  };

  const { error: updateError } = await admin
    .from('dialer_calls')
    .update({
      telecom_provider: 'twilio',
      provider_call_id: callSid ?? call.provider_call_id,
      twilio_call_sid: callSid ?? call.twilio_call_sid,
      status_payload: nextPayload,
      updated_at: now,
    })
    .eq('id', call.id);

  if (updateError) {
    console.error('[twilio/amd-status] failed to update call AMD metadata', updateError);
  }

  return NextResponse.json({ ok: true });
}
