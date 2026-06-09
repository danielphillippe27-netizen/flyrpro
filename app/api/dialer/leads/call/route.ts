import { NextRequest, NextResponse } from 'next/server';
import type { Contact, DialerCall, DialerSession, DialerSessionLead, DiallerLead } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { normalizePhoneNumber } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DiallerLeadCallPayload = {
  workspaceId?: string;
  leadId?: string;
  tabId?: string;
  doubleDial?: boolean;
};

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

async function findOrCreateContact(
  context: Exclude<Awaited<ReturnType<typeof getDialerRequestContext>>, NextResponse>,
  lead: DiallerLead
): Promise<{ contact: Contact | null; error: string | null }> {
  const normalized = normalizePhoneNumber(lead.phone);
  const lookups = [
    normalized.e164 ? { column: 'phone_e164', value: normalized.e164 } : null,
    cleanText(lead.phone) ? { column: 'phone', value: cleanText(lead.phone) } : null,
    cleanText(lead.email) ? { column: 'email', value: cleanText(lead.email) } : null,
  ].filter((lookup): lookup is { column: string; value: string } => Boolean(lookup));

  for (const lookup of lookups) {
    const { data, error } = await context.admin
      .from('contacts')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq(lookup.column, lookup.value)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await context.admin
        .from('contacts')
        .update({
          full_name: cleanText(lead.name) || (data as Contact).full_name || 'Lead',
          phone: cleanText(lead.phone) || (data as Contact).phone || null,
          phone_e164: normalized.e164,
          phone_last_validated_at: now,
          phone_validation_error: normalized.error,
          email: cleanText(lead.email) || (data as Contact).email || null,
          notes: cleanText(lead.notes) || (data as Contact).notes || null,
          updated_at: now,
        })
        .eq('id', data.id)
        .select('*')
        .single();

      if (updateError) {
        console.warn('[dialer/leads/call] failed to refresh contact before call', updateError);
        return { contact: data as Contact, error: null };
      }
      return { contact: updated as Contact, error: null };
    }

    if (error && error.code !== 'PGRST116') {
      console.warn('[dialer/leads/call] contact lookup failed', error);
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await context.admin
    .from('contacts')
    .insert({
      user_id: context.requestUser.id,
      workspace_id: context.workspaceId,
      full_name: cleanText(lead.name) || 'Lead',
      phone: cleanText(lead.phone) || null,
      phone_e164: normalized.e164,
      phone_last_validated_at: now,
      phone_validation_error: normalized.error,
      email: cleanText(lead.email) || null,
      address: '',
      status: 'new',
      notes: cleanText(lead.notes) || null,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[dialer/leads/call] failed to create contact', error);
    return { contact: null, error: 'Failed to prepare this lead for calling.' };
  }

  return { contact: data as Contact, error: null };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as DiallerLeadCallPayload;

  if (!body.leadId) {
    return NextResponse.json({ error: 'leadId is required.' }, { status: 400 });
  }

  const context = await getDialerRequestContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  const { data: lead, error: leadError } = await context.admin
    .from('dialler_leads')
    .select('*')
    .eq('id', body.leadId)
    .eq('workspace_id', context.workspaceId)
    .maybeSingle();

  if (leadError) {
    console.error('[dialer/leads/call] failed to load dialler lead', leadError);
    return NextResponse.json({ error: 'Failed to load dialler lead.' }, { status: 500 });
  }

  if (!lead) {
    return NextResponse.json({ error: 'Dialler lead not found.' }, { status: 404 });
  }

  const diallerLead = lead as DiallerLead;
  const normalized = normalizePhoneNumber(diallerLead.phone);
  if (!normalized.isValid || !normalized.e164) {
    return NextResponse.json({ error: normalized.error ?? 'Phone number is invalid.' }, { status: 400 });
  }

  const preparedContact = await findOrCreateContact(context, diallerLead);
  if (!preparedContact.contact) {
    return NextResponse.json({ error: preparedContact.error ?? 'Failed to prepare contact.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { data: session, error: sessionError } = await context.admin
    .from('dialer_sessions')
    .insert({
      workspace_id: context.workspaceId,
      user_id: context.requestUser.id,
      name: body.doubleDial ? 'Founder Dialler Double Dial' : 'Founder Dialler',
      status: 'active',
      source_filter: {
        source: 'dialler_leads',
        dialler_lead_id: diallerLead.id,
        double_dial: body.doubleDial === true,
      },
      started_at: now,
      tab_id: body.tabId?.trim() || null,
    })
    .select('*')
    .single();

  if (sessionError || !session) {
    console.error('[dialer/leads/call] failed to create session', sessionError);
    return NextResponse.json({ error: 'Failed to create dialler session.' }, { status: 500 });
  }

  const { data: sessionLead, error: sessionLeadError } = await context.admin
    .from('dialer_session_leads')
    .insert({
      session_id: session.id,
      workspace_id: context.workspaceId,
      contact_id: preparedContact.contact.id,
      position: 1,
      status: 'calling',
      attempt_count: 1,
      updated_at: now,
    })
    .select('*')
    .single();

  if (sessionLeadError || !sessionLead) {
    console.error('[dialer/leads/call] failed to create session lead', sessionLeadError);
    return NextResponse.json({ error: 'Failed to create dialler queue item.' }, { status: 500 });
  }

  const callRequestId = crypto.randomUUID();
  const { data: call, error: callError } = await context.admin
    .from('dialer_calls')
    .insert({
      workspace_id: context.workspaceId,
      session_id: session.id,
      session_lead_id: sessionLead.id,
      contact_id: preparedContact.contact.id,
      user_id: context.requestUser.id,
      call_request_id: callRequestId,
      to_number_raw: diallerLead.phone,
      to_number_e164: normalized.e164,
      from_number_e164: context.settings.defaultFromNumber,
      status: 'pending',
      direction: 'outbound',
      status_payload: {
        diallerLeadId: diallerLead.id,
        doubleDial: body.doubleDial === true,
      },
    })
    .select('*')
    .single();

  if (callError || !call) {
    console.error('[dialer/leads/call] failed to create call', callError);
    return NextResponse.json({ error: 'Failed to start outbound call.' }, { status: 500 });
  }

  await context.admin
    .from('dialer_session_leads')
    .update({ last_call_id: call.id, updated_at: now })
    .eq('id', sessionLead.id);

  return NextResponse.json({
    call: call as DialerCall,
    contact: preparedContact.contact,
    session: session as DialerSession,
    sessionLead: sessionLead as DialerSessionLead,
  });
}
