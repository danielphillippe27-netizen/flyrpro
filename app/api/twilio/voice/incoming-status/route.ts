import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioWebhookRequest } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const validation = await validateTwilioWebhookRequest(request);
  if (!validation.isValid) {
    return validation.response!;
  }

  console.info('[twilio/incoming-status]', {
    from: validation.params.From ?? null,
    to: validation.params.To ?? null,
    callSid: validation.params.CallSid ?? null,
    parentCallSid: validation.params.ParentCallSid ?? null,
    callStatus: validation.params.CallStatus ?? null,
    dialCallStatus: validation.params.DialCallStatus ?? null,
    callDuration: validation.params.CallDuration ?? null,
  });

  return NextResponse.json({ ok: true });
}
