import { NextRequest, NextResponse } from 'next/server';
import type { DialerCallDisposition } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { DIALER_CALL_DISPOSITIONS } from '@/lib/dialer/constants';
import { updateMasterLeadDispositionForCall } from '@/lib/sales-leads/master-list';

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

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getPayloadText(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object') return '';
  return cleanText((payload as Record<string, unknown>)[key]);
}

async function createContactForScheduledDisposition(params: {
  context: Exclude<Awaited<ReturnType<typeof getDialerRequestContext>>, NextResponse>;
  call: Record<string, unknown>;
  status: 'hot' | 'warm' | 'cold' | 'new';
  followUpAt: string | null;
  appointmentAt: string | null;
  note: string | null;
  now: string;
}): Promise<string | null> {
  if (!params.followUpAt && !params.appointmentAt) return null;

  const payload = params.call.status_payload;
  const name = getPayloadText(payload, 'diallerLeadName') || 'Lead';
  const phone = getPayloadText(payload, 'diallerLeadPhone') || cleanText(params.call.to_number_raw);
  const email = getPayloadText(payload, 'diallerLeadEmail') || null;

  const { data, error } = await params.context.admin
    .from('contacts')
    .insert({
      user_id: params.context.requestUser.id,
      workspace_id: params.context.workspaceId,
      full_name: name,
      phone: phone || null,
      email,
      address: '',
      status: params.status,
      notes: params.note,
      last_contacted: params.now,
      follow_up_at: params.followUpAt,
      reminder_date: params.followUpAt,
      appointment_at: params.appointmentAt,
      created_at: params.now,
      updated_at: params.now,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[dialer/disposition] failed to create contact for scheduled disposition', error);
    return null;
  }

  return cleanText((data as { id?: unknown } | null)?.id);
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

  const contactId = cleanText(call.contact_id);
  const salesLeadId = cleanText((call as { sales_lead_id?: unknown }).sales_lead_id);
  const contactStatus = dispositionToContactStatus(body.disposition);
  const resolvedFollowUpAt = body.followUpAt || (body.disposition === 'follow_up' || body.disposition === 'callback_requested' ? now : null);
  const resolvedAppointmentAt = body.appointmentAt || null;
  const contactUpdate = {
    status: contactStatus,
    last_contacted: now,
    follow_up_at: resolvedFollowUpAt,
    appointment_at: resolvedAppointmentAt,
    updated_at: now,
  };

  const createdContactId = contactId || salesLeadId
    ? null
    : await createContactForScheduledDisposition({
        context,
        call: call as Record<string, unknown>,
        status: contactStatus,
        followUpAt: resolvedFollowUpAt,
        appointmentAt: resolvedAppointmentAt,
        note: body.note?.trim() || null,
        now,
      });
  const activityContactId = contactId || createdContactId;

  const leadStatus = body.disposition === 'bad_number' ? 'invalid' : body.disposition === 'do_not_call' ? 'skipped' : 'completed';
  const leadSkipReason = body.disposition === 'bad_number' ? 'Bad number' : body.disposition === 'do_not_call' ? 'Do not call' : null;

  const salesLeadUpdate = salesLeadId
    ? {
        disposition: body.disposition,
        lead_state:
          body.disposition === 'appointment_set' || body.disposition === 'connected'
            ? 'contacted'
            : body.disposition === 'follow_up' || body.disposition === 'callback_requested' || body.disposition === 'left_voicemail'
              ? 'callback'
              : body.disposition === 'do_not_call'
                ? 'dnc'
                : body.disposition === 'bad_number' || body.disposition === 'not_interested'
                  ? 'not_now'
                  : 'no_answer',
        notes: body.note?.trim() || null,
        follow_up_at: resolvedFollowUpAt,
        next_follow_up_at: resolvedFollowUpAt,
        last_attempted_at: now,
        called_at: now,
        updated_at: now,
      }
    : null;

  const [{ error: updatedCallError }, contactResult, salesLeadResult, { error: updatedLeadError }, activityResult] = await Promise.all([
    context.admin.from('dialer_calls').update(callUpdate).eq('id', callId),
    contactId
      ? context.admin.from('contacts').update(contactUpdate).eq('id', contactId)
      : Promise.resolve({ error: null }),
    salesLeadUpdate
      ? context.admin.from('sales_leads').update(salesLeadUpdate).eq('id', salesLeadId)
      : Promise.resolve({ error: null }),
    context.admin
      .from('dialer_session_leads')
      .update({
        status: leadStatus,
        skip_reason: leadSkipReason,
        completed_at: now,
        updated_at: now,
      })
      .eq('id', call.session_lead_id),
    activityContactId
      ? context.admin.from('contact_activities').insert({
          contact_id: activityContactId,
          type: 'call',
          note: buildActivityNote({
            disposition: body.disposition,
            durationSeconds: call.duration_seconds,
            note: body.note,
          }),
          timestamp: now,
        })
      : salesLeadId
        ? context.admin.from('sales_activities').insert({
            workspace_id: context.workspaceId,
            sales_lead_id: salesLeadId,
            actor_user_id: context.requestUser.id,
            activity_type: 'call',
            note: buildActivityNote({
              disposition: body.disposition,
              durationSeconds: call.duration_seconds,
              note: body.note,
            }),
            occurred_at: now,
          })
      : Promise.resolve({ error: null }),
  ]);
  const updatedContactError = contactResult.error;
  const updatedSalesLeadError = salesLeadResult.error;
  const activityError = activityResult.error;

  if (updatedCallError || updatedContactError || updatedSalesLeadError || updatedLeadError || activityError) {
    console.error('[dialer/disposition] failed to persist disposition', {
      updatedCallError,
      updatedContactError,
      updatedSalesLeadError,
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

  await updateMasterLeadDispositionForCall({
    admin: context.admin,
    workspaceId: context.workspaceId,
    diallerLeadId: getPayloadText(call.status_payload, 'diallerLeadId') || null,
    phone: getPayloadText(call.status_payload, 'diallerLeadPhone') || cleanText(call.to_number_raw),
    email: getPayloadText(call.status_payload, 'diallerLeadEmail') || null,
    name: getPayloadText(call.status_payload, 'diallerLeadName') || null,
    disposition: body.disposition,
    notes: body.note ?? null,
    nextFollowUpAt: body.followUpAt ?? null,
  });

  return NextResponse.json({ ok: true });
}
