import { NextRequest } from 'next/server';
import twilio from 'twilio';
import { getTwilioInboundFallbackMessage, getTwilioInboundForwardTo } from '@/lib/dialer/env';
import { buildPublicTwilioWebhookUrl, validateTwilioWebhookRequest, xmlResponse } from '@/lib/dialer/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizePhoneNumber } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AdminClient = ReturnType<typeof createAdminClient>;
type RecentDialerCall = {
  user_id: string | null;
};
type ProfilePhone = {
  id: string;
  phone_number: string | null;
};
type SalespersonNumberRoute = {
  workspace_id: string;
  salesperson_id: string;
  inbound_forward_to: string | null;
};

function buildFallbackResponse(message: string) {
  const response = new twilio.twiml.VoiceResponse();
  response.say({ voice: 'alice' }, message);
  response.hangup();
  return xmlResponse(response.toString());
}

async function resolveRecentDialerAgentForwardTo(
  admin: AdminClient,
  callerNumber: string | null,
  calledNumber: string | null
): Promise<string | null> {
  if (!callerNumber || !calledNumber) {
    return null;
  }

  const { data: recentCalls, error: recentCallsError } = await admin
    .from('dialer_calls')
    .select('user_id')
    .eq('direction', 'outbound')
    .eq('to_number_e164', callerNumber)
    .eq('from_number_e164', calledNumber)
    .order('created_at', { ascending: false })
    .limit(5);

  if (recentCallsError) {
    console.error('[twilio/incoming] failed to resolve recent dialer call', recentCallsError);
    return null;
  }

  const userIds = Array.from(
    new Set(
      ((recentCalls ?? []) as RecentDialerCall[])
        .map((call) => call.user_id)
        .filter((userId): userId is string => Boolean(userId))
    )
  );
  if (userIds.length === 0) {
    return null;
  }

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, phone_number')
    .in('id', userIds);

  if (profilesError) {
    console.error('[twilio/incoming] failed to load dialer agent profile phones', profilesError);
    return null;
  }

  const phoneByUserId = new Map(
    ((profiles ?? []) as ProfilePhone[]).map((profile) => [
      profile.id,
      normalizePhoneNumber(profile.phone_number).e164,
    ])
  );

  for (const userId of userIds) {
    const phone = phoneByUserId.get(userId);
    if (phone) {
      return phone;
    }
  }

  return null;
}

async function resolveSalespersonNumberRoute(
  admin: AdminClient,
  calledNumber: string | null
): Promise<SalespersonNumberRoute | null> {
  if (!calledNumber) return null;

  const { data, error } = await admin
    .from('salesperson_dialer_settings')
    .select('workspace_id, salesperson_id, inbound_forward_to')
    .or(`assigned_phone_number.eq.${calledNumber},default_sms_from_number.eq.${calledNumber}`)
    .eq('number_status', 'active')
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[twilio/incoming] salesperson number lookup failed', error);
    return null;
  }

  return (data as SalespersonNumberRoute | null) ?? null;
}

export async function POST(request: NextRequest) {
  const validation = await validateTwilioWebhookRequest(request);
  if (!validation.isValid) {
    return validation.response!;
  }

  const calledNumber =
    normalizePhoneNumber(validation.params.To ?? validation.params.Called).e164;
  const callerNumber =
    normalizePhoneNumber(validation.params.From ?? validation.params.Caller).e164;
  let forwardToNumber: string | null = null;

  const admin = createAdminClient();
  const salespersonRoute = await resolveSalespersonNumberRoute(admin, calledNumber);
  forwardToNumber = normalizePhoneNumber(salespersonRoute?.inbound_forward_to).e164;

  forwardToNumber ||= await resolveRecentDialerAgentForwardTo(
    admin,
    callerNumber,
    calledNumber
  );

  if (calledNumber) {
    const { data } = await admin
      .from('workspace_dialer_settings')
      .select('inbound_forward_to')
      .eq('default_from_number', calledNumber)
      .maybeSingle();
    forwardToNumber ||= normalizePhoneNumber(data?.inbound_forward_to).e164;
  }

  forwardToNumber ||= getTwilioInboundForwardTo();
  if (!forwardToNumber) {
    return buildFallbackResponse(getTwilioInboundFallbackMessage());
  }

  const response = new twilio.twiml.VoiceResponse();
  const statusUrl = buildPublicTwilioWebhookUrl(request, '/api/twilio/voice/incoming-status');

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
