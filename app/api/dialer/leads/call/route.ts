import { NextRequest, NextResponse } from 'next/server';
import type { Contact, DialerCall, DialerSession, DialerSessionLead, DiallerLead } from '@/types/database';
import { getDialerRequestContext, type DialerRequestContext } from '@/lib/dialer/server';
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

async function findExistingContact(
  context: DialerRequestContext,
  lead: DiallerLead
): Promise<Contact | null> {
  const normalizedPhone = normalizePhoneNumber(lead.phone);
  const lookups = [
    normalizedPhone.e164 ? { column: 'phone_e164', value: normalizedPhone.e164 } : null,
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

    if (!error && data) return data as Contact;
    if (error && error.code !== 'PGRST116') {
      console.warn('[dialer/leads/call] contact lookup failed', error);
    }
  }

  return null;
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

  const now = new Date().toISOString();
  const existingContact = await findExistingContact(context, diallerLead);
  const contactId = existingContact?.id ?? null;
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
      contact_id: contactId,
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
      contact_id: contactId,
      user_id: context.requestUser.id,
      call_request_id: callRequestId,
      to_number_raw: diallerLead.phone,
      to_number_e164: normalized.e164,
      from_number_e164: context.settings.defaultFromNumber,
      status: 'pending',
      direction: 'outbound',
      status_payload: {
        diallerLeadId: diallerLead.id,
        diallerLeadName: cleanText(diallerLead.name) || 'Lead',
        diallerLeadPhone: cleanText(diallerLead.phone),
        diallerLeadEmail: cleanText(diallerLead.email) || null,
        diallerLeadCompany: cleanText(diallerLead.company) || null,
        salespersonId: context.salesperson?.id ?? null,
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
    contact: existingContact,
    session: session as DialerSession,
    sessionLead: sessionLead as DialerSessionLead,
  });
}
