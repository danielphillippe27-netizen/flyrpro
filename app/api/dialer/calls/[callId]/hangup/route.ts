import { NextRequest, NextResponse } from 'next/server';
import type { DialerCall } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { hangupTelnyxCall } from '@/lib/dialer/telnyx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HangupPayload = {
  workspaceId?: string;
  outcome?: 'connected' | 'completed';
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const body = (await request.json().catch(() => ({}))) as HangupPayload;
  const { callId } = await params;
  const context = await getDialerRequestContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  const { data: call, error } = await context.admin
    .from('dialer_calls')
    .select('*')
    .eq('id', callId)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .maybeSingle();

  if (error) {
    console.error('[dialer/calls/hangup] failed to load call', error);
    return NextResponse.json({ error: 'Failed to load call.' }, { status: 500 });
  }
  if (!call) {
    return NextResponse.json({ error: 'Call not found.' }, { status: 404 });
  }

  const activeCall = call as DialerCall;

  const callControlIds = Array.from(
    new Set([activeCall.provider_call_id, activeCall.provider_parent_call_id].filter((id): id is string => Boolean(id)))
  );

  if (activeCall.telecom_provider === 'telnyx' && callControlIds.length > 0) {
    await Promise.allSettled(
      callControlIds.map((callControlId) =>
        hangupTelnyxCall(callControlId, { commandId: `${activeCall.call_request_id}:hangup:${callControlId}` })
      )
    );
  }

  const now = new Date().toISOString();
  const wasConnected = body.outcome === 'connected' || Boolean(activeCall.answered_at);
  const { data: updatedCall, error: updateError } = await context.admin
    .from('dialer_calls')
    .update({
      status: wasConnected ? 'completed' : 'canceled',
      answered_at: wasConnected ? activeCall.answered_at ?? now : activeCall.answered_at,
      ended_at: activeCall.ended_at ?? now,
      disposition: body.outcome === 'connected' ? activeCall.disposition ?? 'connected' : activeCall.disposition,
      updated_at: now,
    })
    .eq('id', activeCall.id)
    .select('*')
    .single();

  if (updateError || !updatedCall) {
    console.error('[dialer/calls/hangup] failed to update call', updateError);
    return NextResponse.json({ error: 'Call hangup was requested, but the row was not updated.' }, { status: 500 });
  }

  await context.admin
    .from('dialer_session_leads')
    .update({
      status: 'completed',
      completed_at: now,
      updated_at: now,
    })
    .eq('id', activeCall.session_lead_id);

  return NextResponse.json({ call: updatedCall as DialerCall });
}
