import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { validateTwilioWebhookRequest } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveMp3Url(recordingUrl: string | null) {
  if (!recordingUrl) return null;
  return recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`;
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
    console.error('[twilio/recording-status] failed to load call', callError);
    return NextResponse.json({ ok: true });
  }

  if (!call) {
    return NextResponse.json({ ok: true });
  }

  const now = new Date().toISOString();
  const recordingUrl = validation.params.RecordingUrl ?? null;
  const nextPayload = {
    ...(typeof call.status_payload === 'object' && call.status_payload ? call.status_payload : {}),
    recording: {
      recordingSid: validation.params.RecordingSid ?? null,
      recordingUrl,
      mp3Url: resolveMp3Url(recordingUrl),
      status: validation.params.RecordingStatus ?? 'pending',
      durationSeconds: Number(validation.params.RecordingDuration ?? 0) || null,
      channels: Number(validation.params.RecordingChannels ?? 0) || null,
      errorCode: validation.params.ErrorCode ?? null,
      updatedAt: now,
      lastWebhook: validation.params,
    },
  };

  const { error: updateError } = await admin
    .from('dialer_calls')
    .update({
      twilio_call_sid: callSid ?? call.twilio_call_sid,
      status_payload: nextPayload,
      updated_at: now,
    })
    .eq('id', call.id);

  if (updateError) {
    console.error('[twilio/recording-status] failed to update recording metadata', updateError);
  }

  return NextResponse.json({ ok: true });
}
