import { NextRequest, NextResponse } from 'next/server';
import type { DialerCall } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { launchTelnyxBridgeCall } from '@/lib/dialer/telnyx-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type OutboundPayload = {
  workspaceId?: string;
  callId?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as OutboundPayload;
  if (!body.callId) {
    return NextResponse.json({ error: 'callId is required.' }, { status: 400 });
  }

  const context = await getDialerRequestContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  const { data: call, error: callError } = await context.admin
    .from('dialer_calls')
    .select('*')
    .eq('id', body.callId)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .eq('telecom_provider', 'telnyx')
    .maybeSingle();

  if (callError) {
    console.error('[telnyx/voice/outbound] failed to load call', callError);
    return NextResponse.json({ error: 'Failed to load call.' }, { status: 500 });
  }
  if (!call) {
    return NextResponse.json({ error: 'Telnyx call not found.' }, { status: 404 });
  }

  const activeCall = call as DialerCall;
  if (activeCall.provider_parent_call_id || activeCall.provider_call_id) {
    return NextResponse.json({ call: activeCall });
  }

  try {
    const launch = await launchTelnyxBridgeCall({
      request,
      callId: activeCall.id,
      callRequestId: activeCall.call_request_id,
      fromNumber: activeCall.from_number_e164,
      toNumber: activeCall.to_number_e164,
      statusPayload: activeCall.status_payload,
    });

    const { data: updatedCall, error: updateError } = await context.admin
      .from('dialer_calls')
      .update({
        provider_parent_call_id: launch.agentDial.callControlId,
        status: 'initiated',
        status_payload: launch.statusPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activeCall.id)
      .select('*')
      .single();

    if (updateError || !updatedCall) {
      console.error('[telnyx/voice/outbound] failed to persist launch metadata', updateError);
      return NextResponse.json({ error: 'Telnyx call launched, but metadata was not saved.' }, { status: 500 });
    }

    return NextResponse.json({ call: updatedCall as DialerCall });
  } catch (error) {
    console.error('[telnyx/voice/outbound] failed to launch call', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to launch Telnyx call.' },
      { status: 502 }
    );
  }
}
