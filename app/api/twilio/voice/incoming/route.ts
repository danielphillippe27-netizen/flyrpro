import { NextRequest } from 'next/server';
import twilio from 'twilio';
import { getTwilioInboundFallbackMessage, getTwilioInboundForwardTo } from '@/lib/dialer/env';
import { validateTwilioWebhookRequest, xmlResponse } from '@/lib/dialer/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizePhoneNumber } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildFallbackResponse(message: string) {
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

  const calledNumber =
    normalizePhoneNumber(validation.params.To ?? validation.params.Called).e164;
  let forwardToNumber: string | null = null;

  if (calledNumber) {
    const admin = createAdminClient();
    const { data } = await admin
      .from('workspace_dialer_settings')
      .select('inbound_forward_to')
      .eq('default_from_number', calledNumber)
      .maybeSingle();
    forwardToNumber = normalizePhoneNumber(data?.inbound_forward_to).e164;
  }

  forwardToNumber ||= getTwilioInboundForwardTo();
  if (!forwardToNumber) {
    return buildFallbackResponse(getTwilioInboundFallbackMessage());
  }

  const response = new twilio.twiml.VoiceResponse();
  const statusUrl = new URL('/api/twilio/voice/incoming-status', request.url);

  const dial = response.dial({
    answerOnBridge: true,
  });

  dial.number(
    {
      statusCallback: statusUrl.toString(),
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    },
    forwardToNumber
  );

  response.say({ voice: 'alice' }, 'The person you are trying to reach is unavailable right now. Please leave a voicemail or try again later.');

  return xmlResponse(response.toString());
}
