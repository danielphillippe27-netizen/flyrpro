import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { isFinalCallStatus } from '@/lib/dialer/constants';
import { validateTwilioWebhookRequest } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const status = validation.params.CallStatus ?? null;

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
    console.error('[twilio/status] failed to load call', callError);
    return NextResponse.json({ ok: true });
  }

  if (!call) {
    return NextResponse.json({ ok: true });
  }

  const now = new Date().toISOString();
  const resolvedStatus = status === 'in-progress' && !call.answered_at ? 'answered' : status;
  const durationSeconds = Number(validation.params.CallDuration ?? 0) || null;
  const nextPayload = {
    ...(typeof call.status_payload === 'object' && call.status_payload ? call.status_payload : {}),
    lastWebhook: validation.params,
  };

  const updatePayload: Record<string, unknown> = {
    twilio_call_sid: callSid,
    twilio_parent_call_sid: validation.params.ParentCallSid ?? call.twilio_parent_call_sid,
    status: resolvedStatus ?? call.status,
    duration_seconds: durationSeconds,
    status_payload: nextPayload,
    updated_at: now,
  };

  if ((resolvedStatus === 'answered' || resolvedStatus === 'in-progress') && !call.answered_at) {
    updatePayload.answered_at = now;
  }
  if (isFinalCallStatus(resolvedStatus) && !call.ended_at) {
    updatePayload.ended_at = now;
  }

  const { error: updateError } = await admin
    .from('dialer_calls')
    .update(updatePayload)
    .eq('id', call.id);

  if (updateError) {
    console.error('[twilio/status] failed to update call', updateError);
  }

  return NextResponse.json({ ok: true });
}
