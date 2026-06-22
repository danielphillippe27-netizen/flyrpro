import { NextRequest, NextResponse } from 'next/server';
import type { Contact, DialerCall, DialerSession, DialerSessionLead } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { getActiveDialerEnvIssues, getDialerTelecomProvider } from '@/lib/dialer/env';
import { normalizePhoneNumber, phoneMarketFromCountryCode } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SessionPayload = {
  workspaceId?: string;
  contactIds?: string[];
  name?: string;
  tabId?: string;
};

type LegacyFieldLead = {
  id: string;
  user_id: string | null;
  workspace_id?: string | null;
  full_name?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  campaign_id?: string | null;
  farm_id?: string | null;
  status?: string | null;
  source?: string | null;
  notes?: string | null;
  tags?: string | null;
  last_contacted?: string | null;
  reminder_date?: string | null;
  follow_up_at?: string | null;
  appointment_at?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function normalizeLegacyStatus(status?: string | null): Contact['status'] {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) return 'new';
  if (normalized === 'new' || normalized === 'hot' || normalized === 'warm' || normalized === 'cold') {
    return normalized;
  }
  if (['interested', 'appointment', 'talked', 'converted'].includes(normalized)) return 'hot';
  if (['delivered', 'contacted', 'follow_up', 'follow-up'].includes(normalized)) return 'warm';
  if (['not_interested', 'uninterested', 'dnc', 'do_not_knock', 'do-not-knock'].includes(normalized)) {
    return 'cold';
  }
  return 'new';
}

function normalizeContactPhone(contact: Contact) {
  return normalizePhoneNumber(
    (contact.phone_e164 ?? '').trim() || contact.phone,
    phoneMarketFromCountryCode(contact.phone_country_code)
  );
}

function buildContactInsertFromLegacy(
  lead: LegacyFieldLead,
  workspaceId: string,
  userId: string
) {
  return {
    user_id: userId,
    workspace_id: workspaceId,
    full_name: (lead.full_name ?? lead.name ?? '').trim() || 'Lead',
    phone: lead.phone ?? null,
    email: lead.email ?? null,
    address: (lead.address ?? '').trim(),
    campaign_id: lead.campaign_id ?? null,
    farm_id: lead.farm_id ?? null,
    status: normalizeLegacyStatus(lead.status),
    source: lead.source ?? null,
    notes: lead.notes ?? null,
    last_contacted: lead.last_contacted ?? null,
    follow_up_at: lead.follow_up_at ?? lead.reminder_date ?? null,
    appointment_at: lead.appointment_at ?? null,
    tags: lead.tags ?? null,
  };
}

function summarizeSession(leads: DialerSessionLead[], calls: DialerCall[]) {
  const completed = leads.filter((lead) => lead.status === 'completed').length;
  const invalid = leads.filter((lead) => lead.status === 'invalid').length;
  const skipped = leads.filter((lead) => lead.status === 'skipped').length;
  const pending = leads.filter((lead) => ['pending', 'claimed', 'calling'].includes(lead.status)).length;
  const connected = calls.filter((call) => call.disposition === 'connected' || call.disposition === 'appointment_set').length;
  return {
    total: leads.length,
    pending,
    completed,
    skipped,
    invalid,
    callsPlaced: calls.length,
    connected,
  };
}

async function buildSessionResponse(
  admin: ReturnType<typeof import('@/lib/supabase/server').createAdminClient>,
  session: DialerSession
) {
  const [{ data: leadRows, error: leadsError }, { data: callRows, error: callsError }] = await Promise.all([
    admin
      .from('dialer_session_leads')
      .select('*')
      .eq('session_id', session.id)
      .order('position', { ascending: true }),
    admin
      .from('dialer_calls')
      .select('*')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false }),
  ]);

  if (leadsError) throw leadsError;
  if (callsError) throw callsError;

  const contactIds = Array.from(new Set((leadRows ?? []).map((row) => row.contact_id).filter(Boolean)));
  let contacts: Contact[] = [];

  if (contactIds.length > 0) {
    const { data: contactRows, error: contactsError } = await admin
      .from('contacts')
      .select('*')
      .in('id', contactIds);
    if (contactsError) throw contactsError;
    contacts = (contactRows ?? []) as Contact[];
  }

  const contactsById = contacts.reduce<Record<string, Contact>>((acc, contact) => {
    acc[contact.id] = contact;
    return acc;
  }, {});

  const leads = ((leadRows ?? []) as DialerSessionLead[]).map((lead) => ({
    ...lead,
    contact: lead.contact_id ? contactsById[lead.contact_id] : undefined,
  }));
  const calls = (callRows ?? []) as DialerCall[];

  return {
    session,
    leads,
    calls,
    summary: summarizeSession(leads, calls),
  };
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const sessionId = request.nextUrl.searchParams.get('sessionId');

  try {
    const context = await getDialerRequestContext(request, workspaceId);
    if (context instanceof NextResponse) {
      return context;
    }

    let query = context.admin
      .from('dialer_sessions')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.requestUser.id);

    if (sessionId) {
      query = query.eq('id', sessionId);
    } else {
      query = query.in('status', ['active', 'paused']).order('created_at', { ascending: false }).limit(1);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error('[dialer/sessions] failed to load session', error);
      return NextResponse.json({ error: 'Failed to load dialer session' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ session: null, leads: [], calls: [], summary: summarizeSession([], []) });
    }

    const response = await buildSessionResponse(context.admin, data as DialerSession);
    return NextResponse.json(response);
  } catch (error) {
    console.error('[dialer/sessions] failed to build session context', error);
    const envIssues = getActiveDialerEnvIssues();
    const provider = getDialerTelecomProvider();
    return NextResponse.json(
      {
        error:
          envIssues.length > 0
            ? `${provider === 'telnyx' ? 'Telnyx' : 'Twilio'} is not configured. Missing or invalid: ${envIssues.join(', ')}`
            : error instanceof Error
              ? error.message
              : 'Failed to load dialer session',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as SessionPayload;
  const contactIds = Array.isArray(body.contactIds)
    ? Array.from(new Set(body.contactIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
    : [];

  if (contactIds.length === 0) {
    return NextResponse.json({ error: 'Choose at least one lead to start a dialer session' }, { status: 400 });
  }

  try {
    const context = await getDialerRequestContext(request, body.workspaceId);
    if (context instanceof NextResponse) {
      return context;
    }

    const uuidContactIds = contactIds.filter(isUuid);
    const contactRows: Contact[] = [];

    if (uuidContactIds.length > 0) {
      const { data: contacts, error: contactsError } = await context.admin
        .from('contacts')
        .select('*')
        .eq('workspace_id', context.workspaceId)
        .in('id', uuidContactIds);

      if (contactsError) {
        console.error('[dialer/sessions] failed to load contacts', contactsError);
        return NextResponse.json({ error: 'Failed to load selected contacts' }, { status: 500 });
      }

      contactRows.push(...((contacts ?? []) as Contact[]));
    }

    const contactsByRequestedId = contactRows.reduce<Record<string, Contact>>((acc, contact) => {
      acc[contact.id] = contact;
      return acc;
    }, {});

    const unresolvedIds = contactIds.filter((id) => !contactsByRequestedId[id]);
    if (unresolvedIds.length > 0) {
      const { data: legacyRows, error: legacyError } = await context.admin
        .from('field_leads')
        .select('*')
        .eq('workspace_id', context.workspaceId)
        .in('id', unresolvedIds);

      if (legacyError) {
        console.warn('[dialer/sessions] failed to load legacy selected contacts', legacyError);
      } else if (legacyRows && legacyRows.length > 0) {
        const inserts = (legacyRows as LegacyFieldLead[]).map((lead) =>
          buildContactInsertFromLegacy(lead, context.workspaceId, context.requestUser.id)
        );
        const { data: insertedContacts, error: insertError } = await context.admin
          .from('contacts')
          .insert(inserts)
          .select('*');

        if (insertError) {
          console.error('[dialer/sessions] failed to migrate legacy selected contacts', insertError);
          return NextResponse.json(
            { error: 'Failed to prepare selected leads for the dialer' },
            { status: 500 }
          );
        }

        const insertedBySignature = new Map<string, Contact>();
        for (const contact of (insertedContacts ?? []) as Contact[]) {
          const signature = [
            contact.full_name.trim().toLowerCase(),
            (contact.phone ?? '').trim(),
            (contact.email ?? '').trim().toLowerCase(),
            (contact.address ?? '').trim().toLowerCase(),
            (contact.campaign_id ?? '').trim(),
          ].join('|');
          insertedBySignature.set(signature, contact);
          contactRows.push(contact);
        }

        for (const lead of legacyRows as LegacyFieldLead[]) {
          const signature = [
            (lead.full_name ?? lead.name ?? '').trim().toLowerCase() || 'lead',
            (lead.phone ?? '').trim(),
            (lead.email ?? '').trim().toLowerCase(),
            (lead.address ?? '').trim().toLowerCase(),
            (lead.campaign_id ?? '').trim(),
          ].join('|');
          const inserted = insertedBySignature.get(signature);
          if (inserted) {
            contactsByRequestedId[lead.id] = inserted;
          }
        }
      }
    }

    for (const contact of contactRows) {
      contactsByRequestedId[contact.id] = contact;
    }

    const orderedContacts = contactIds
      .map((id) => contactsByRequestedId[id])
      .filter((value): value is Contact => Boolean(value));

    if (orderedContacts.length === 0) {
      return NextResponse.json({ error: 'No matching contacts were found in this workspace' }, { status: 404 });
    }

    const now = new Date().toISOString();
    await context.admin
      .from('dialer_sessions')
      .update({ status: 'completed', ended_at: now, updated_at: now })
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.requestUser.id)
      .in('status', ['active', 'paused']);

    const { data: session, error: sessionError } = await context.admin
      .from('dialer_sessions')
      .insert({
        workspace_id: context.workspaceId,
        user_id: context.requestUser.id,
        name: body.name?.trim() || `Power Dialer ${new Date().toLocaleDateString()}`,
        status: 'active',
        source_filter: { contact_ids: orderedContacts.map((contact) => contact.id) },
        started_at: now,
        tab_id: body.tabId?.trim() || null,
      })
      .select('*')
      .single();

    if (sessionError || !session) {
      console.error('[dialer/sessions] failed to create session', sessionError);
      return NextResponse.json({ error: 'Failed to create dialer session' }, { status: 500 });
    }

    const leadInserts: Array<Record<string, unknown>> = [];
    const contactUpdates = orderedContacts.map((contact, index) => {
      const normalized = normalizeContactPhone(contact);
      leadInserts.push({
        session_id: session.id,
        workspace_id: context.workspaceId,
        contact_id: contact.id,
        position: index + 1,
        status: normalized.isValid ? 'pending' : 'invalid',
        skip_reason: normalized.isValid ? null : normalized.error,
      });

      return context.admin
        .from('contacts')
        .update({
          phone_e164: normalized.e164,
          phone_country_code: normalized.countryCode,
          phone_area_code: normalized.areaCode,
          phone_area_label: normalized.areaLabel,
          phone_last_validated_at: now,
          phone_validation_error: normalized.error,
          updated_at: now,
        })
        .eq('id', contact.id);
    });

    const [{ error: leadsError }, ...updateResults] = await Promise.all([
      context.admin.from('dialer_session_leads').insert(leadInserts),
      ...contactUpdates,
    ]);

    if (leadsError) {
      console.error('[dialer/sessions] failed to insert session leads', leadsError);
      return NextResponse.json({ error: 'Failed to create dialer queue' }, { status: 500 });
    }

    const updateError = updateResults.find((result) => result.error)?.error;
    if (updateError) {
      console.warn('[dialer/sessions] contact phone normalization update failed', updateError);
    }

    const response = await buildSessionResponse(context.admin, session as DialerSession);
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('[dialer/sessions] failed to create session context', error);
    const envIssues = getActiveDialerEnvIssues();
    const provider = getDialerTelecomProvider();
    return NextResponse.json(
      {
        error:
          envIssues.length > 0
            ? `${provider === 'telnyx' ? 'Telnyx' : 'Twilio'} is not configured. Missing or invalid: ${envIssues.join(', ')}`
            : error instanceof Error
              ? error.message
              : 'Failed to create dialer session',
      },
      { status: 500 }
    );
  }
}
