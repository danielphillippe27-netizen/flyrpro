import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { validateTwilioWebhookRequest } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isSentStatus(status: string | null | undefined) {
  return status === 'sent' || status === 'delivered';
}

export async function POST(request: NextRequest) {
  const validation = await validateTwilioWebhookRequest(request);
  if (!validation.isValid) {
    return validation.response!;
  }

  const messageSid = validation.params.MessageSid ?? null;
  const status = validation.params.MessageStatus ?? null;

  if (!messageSid) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const { data: followup, error: followupError } = await admin
    .from('dialer_sms_followups')
    .select('*')
    .eq('twilio_message_sid', messageSid)
    .maybeSingle();

  if (followupError) {
    console.error('[twilio/messaging/status] failed to load follow-up', followupError);
    return NextResponse.json({ ok: true });
  }

  if (!followup) {
    return NextResponse.json({ ok: true });
  }

  const now = new Date().toISOString();
  const nextPayload = {
    ...(typeof followup.status_payload === 'object' && followup.status_payload ? followup.status_payload : {}),
    lastWebhook: validation.params,
  };

  const updatePayload: Record<string, unknown> = {
    telecom_provider: 'twilio',
    provider_message_id: messageSid,
    status: status ?? followup.status,
    error_code: validation.params.ErrorCode ?? followup.error_code,
    error_message: validation.params.ErrorMessage ?? followup.error_message,
    status_payload: nextPayload,
    updated_at: now,
  };

  if (isSentStatus(status) && !followup.sent_at) {
    updatePayload.sent_at = now;
  }

  if (status === 'delivered' && !followup.delivered_at) {
    updatePayload.delivered_at = now;
  }

  const { error: updateError } = await admin
    .from('dialer_sms_followups')
    .update(updatePayload)
    .eq('id', followup.id);

  if (updateError) {
    console.error('[twilio/messaging/status] failed to update follow-up', updateError);
  }

  return NextResponse.json({ ok: true });
}
