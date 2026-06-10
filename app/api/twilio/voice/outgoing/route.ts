import { NextRequest } from 'next/server';
import twilio from 'twilio';
import { buildPublicTwilioWebhookUrl, validateTwilioWebhookRequest, xmlResponse } from '@/lib/dialer/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getTwilioDefaultFromNumber } from '@/lib/dialer/env';
import { normalizePhoneNumber } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildUnavailableResponse(message: string) {
  const response = new twilio.twiml.VoiceResponse();
  response.say({ voice: 'alice' }, message);
  response.hangup();
  return xmlResponse(response.toString());
}

export async function POST(request: NextRequest) {
  const validation = await validateTwilioWebhookRequest(request);
  if (!validation.isValid) {
    return validation.response!;
  }

  const callRequestId = validation.params.call_request_id ?? validation.params.callRequestId ?? validation.params.To;
  console.info('[twilio/outgoing] routing request', {
    callRequestIdFound: Boolean(callRequestId),
    paramKeys: Object.keys(validation.params).sort(),
    callSid: validation.params.CallSid ?? null,
    from: validation.params.From ?? null,
    toPresent: Boolean(validation.params.To),
  });
  if (!callRequestId) {
    return buildUnavailableResponse('Call routing information was missing.');
  }

  const admin = createAdminClient();
  const { data: call, error: callError } = await admin
    .from('dialer_calls')
    .select('*')
    .eq('call_request_id', callRequestId)
    .maybeSingle();

  if (callError) {
    console.error('[twilio/outgoing] failed to load call', callError);
    return buildUnavailableResponse('Call routing failed.');
  }

  const toNumber = normalizePhoneNumber(call?.to_number_e164).e164;
  const callerId = normalizePhoneNumber(call?.from_number_e164).e164 || getTwilioDefaultFromNumber();

  if (!call || !toNumber || !callerId) {
    console.warn('[twilio/outgoing] call routing row missing phone numbers', {
      callRequestId,
      callFound: Boolean(call),
      hasToNumber: Boolean(toNumber),
      hasFromNumber: Boolean(callerId),
    });
    return buildUnavailableResponse('The lead phone number is unavailable.');
  }

  const response = new twilio.twiml.VoiceResponse();
  const callbackUrl = buildPublicTwilioWebhookUrl(request, '/api/twilio/voice/status');
  callbackUrl.searchParams.set('callRequestId', callRequestId);
  const recordingStatusUrl = buildPublicTwilioWebhookUrl(request, '/api/twilio/voice/recording-status');
  recordingStatusUrl.searchParams.set('callRequestId', callRequestId);

  const dial = response.dial({
    callerId,
    answerOnBridge: true,
    record: 'record-from-answer-dual',
    recordingStatusCallback: recordingStatusUrl.toString(),
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: ['in-progress', 'completed', 'absent'],
  });

  dial.number(
    {
      statusCallback: callbackUrl.toString(),
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    },
    toNumber
  );

  await admin
    .from('dialer_calls')
    .update({
      status: 'initiated',
      twilio_parent_call_sid: validation.params.CallSid ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', call.id);

  return xmlResponse(response.toString());
}
