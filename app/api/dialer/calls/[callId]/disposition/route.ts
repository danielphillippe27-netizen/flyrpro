import { NextRequest, NextResponse } from 'next/server';
import type { DialerCallDisposition } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { DIALER_CALL_DISPOSITIONS } from '@/lib/dialer/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DispositionPayload = {
  workspaceId?: string;
  disposition?: DialerCallDisposition;
  note?: string;
  followUpAt?: string | null;
  appointmentAt?: string | null;
};

function dispositionToContactStatus(disposition: DialerCallDisposition | undefined): 'hot' | 'warm' | 'cold' | 'new' {
  switch (disposition) {
    case 'connected':
    case 'appointment_set':
      return 'hot';
    case 'follow_up':
    case 'callback_requested':
    case 'left_voicemail':
      return 'warm';
    case 'do_not_call':
    case 'bad_number':
    case 'not_interested':
      return 'cold';
    default:
      return 'new';
  }
}

function buildActivityNote(payload: {
  disposition?: DialerCallDisposition;
  durationSeconds?: number | null;
  note?: string | null;
}) {
  const fragments = [];
  if (payload.disposition) {
    fragments.push(`Disposition: ${payload.disposition.replace(/_/g, ' ')}`);
  }
  if (typeof payload.durationSeconds === 'number' && payload.durationSeconds > 0) {
    fragments.push(`Duration: ${payload.durationSeconds}s`);
  }
  if (payload.note?.trim()) {
    fragments.push(payload.note.trim());
  }
  return fragments.join(' | ');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const body = (await request.json().catch(() => ({}))) as DispositionPayload;
  const { callId } = await params;

  if (!body.disposition || !DIALER_CALL_DISPOSITIONS.includes(body.disposition)) {
    return NextResponse.json({ error: 'Choose a valid call disposition' }, { status: 400 });
  }

  const context = await getDialerRequestContext(request, body.workspaceId);
  if (context instanceof NextResponse) {
    return context;
  }

  const { data: call, error: callError } = await context.admin
    .from('dialer_calls')
    .select('*')
    .eq('id', callId)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .maybeSingle();

  if (callError) {
    console.error('[dialer/disposition] failed to load call', callError);
    return NextResponse.json({ error: 'Failed to load call' }, { status: 500 });
  }

  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const callStatus =
    call.status === 'completed' || call.status === 'busy' || call.status === 'failed' || call.status === 'no-answer' || call.status === 'canceled'
      ? call.status
      : 'completed';

  const callUpdate = {
    disposition: body.disposition,
    disposition_note: body.note?.trim() || null,
    follow_up_at: body.followUpAt || null,
    appointment_at: body.appointmentAt || null,
    status: callStatus,
    ended_at: call.ended_at ?? now,
    updated_at: now,
  };

  const contactUpdate = {
    status: dispositionToContactStatus(body.disposition),
    last_contacted: now,
    follow_up_at: body.followUpAt || (body.disposition === 'follow_up' || body.disposition === 'callback_requested' ? now : null),
    appointment_at: body.appointmentAt || null,
    updated_at: now,
  };

  const leadStatus = body.disposition === 'bad_number' ? 'invalid' : body.disposition === 'do_not_call' ? 'skipped' : 'completed';
  const leadSkipReason = body.disposition === 'bad_number' ? 'Bad number' : body.disposition === 'do_not_call' ? 'Do not call' : null;

  const [{ error: updatedCallError }, { error: updatedContactError }, { error: updatedLeadError }, { error: activityError }] = await Promise.all([
    context.admin.from('dialer_calls').update(callUpdate).eq('id', callId),
    context.admin.from('contacts').update(contactUpdate).eq('id', call.contact_id),
    context.admin
      .from('dialer_session_leads')
      .update({
        status: leadStatus,
        skip_reason: leadSkipReason,
        completed_at: now,
        updated_at: now,
      })
      .eq('id', call.session_lead_id),
    context.admin.from('contact_activities').insert({
      contact_id: call.contact_id,
      type: 'call',
      note: buildActivityNote({
        disposition: body.disposition,
        durationSeconds: call.duration_seconds,
        note: body.note,
      }),
      timestamp: now,
    }),
  ]);

  if (updatedCallError || updatedContactError || updatedLeadError || activityError) {
    console.error('[dialer/disposition] failed to persist disposition', {
      updatedCallError,
      updatedContactError,
      updatedLeadError,
      activityError,
    });
    return NextResponse.json({ error: 'Failed to save call disposition' }, { status: 500 });
  }

  const { count: remainingLeadCount, error: remainingError } = await context.admin
    .from('dialer_session_leads')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', call.session_id)
    .in('status', ['pending', 'claimed', 'calling']);

  if (!remainingError && !remainingLeadCount) {
    await context.admin
      .from('dialer_sessions')
      .update({ status: 'completed', ended_at: now, updated_at: now })
      .eq('id', call.session_id);
  }

  return NextResponse.json({ ok: true });
}
