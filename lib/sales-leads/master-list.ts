import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import type {
  DialerCallDisposition,
  DiallerLead,
  DiallerLeadDisposition,
  SalespersonLeadMaster,
  SalespersonLeadMasterState,
} from '@/types/database';

type SupabaseAdmin = Pick<SupabaseClient, 'from'>;

export type MasterLeadInput = {
  workspaceId: string;
  assignedUserId: string;
  assignedSalespersonId?: string | null;
  createdByUserId?: string | null;
  contactId?: string | null;
  diallerLeadId?: string | null;
  name: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  websiteDomain?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  countryCode?: string | null;
  source?: string | null;
  externalId?: string | null;
  state?: SalespersonLeadMasterState;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type MasterLeadResult = {
  available: boolean;
  created: boolean;
  existing: boolean;
  row: SalespersonLeadMaster | null;
  warning: string | null;
};

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizedEmail(value: string | null | undefined): string {
  return cleanText(value).toLowerCase();
}

function isMissingMasterTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const text = `${String(candidate.message ?? '')} ${String(candidate.details ?? '')}`.toLowerCase();
  return candidate.code === '42P01' || text.includes('salesperson_lead_master');
}

function leadFingerprint(input: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}): string {
  const normalizedPhone = normalizePhoneNumber(input.phone).e164 || cleanText(input.phone).replace(/\D/g, '');
  return [
    cleanText(input.name).toLowerCase(),
    normalizedPhone,
    normalizedEmail(input.email),
    cleanText(input.address).toLowerCase(),
  ]
    .filter(Boolean)
    .join('|');
}

function shapeMasterPayload(input: MasterLeadInput) {
  const normalizedPhone = normalizePhoneNumber(input.phone);
  const email = cleanText(input.email) || null;
  return {
    workspace_id: input.workspaceId,
    contact_id: cleanText(input.contactId) || null,
    dialler_lead_id: cleanText(input.diallerLeadId) || null,
    assigned_user_id: input.assignedUserId,
    assigned_salesperson_id: cleanText(input.assignedSalespersonId) || null,
    created_by_user_id: cleanText(input.createdByUserId) || input.assignedUserId,
    name: cleanText(input.name) || 'Lead',
    company: cleanText(input.company) || null,
    phone: cleanText(input.phone) || null,
    phone_e164: normalizedPhone.e164 || null,
    email,
    email_normalized: email ? email.toLowerCase() : null,
    website: cleanText(input.website) || null,
    website_domain: cleanText(input.websiteDomain) || null,
    address: cleanText(input.address) || null,
    city: cleanText(input.city) || null,
    region: cleanText(input.region) || null,
    country_code: cleanText(input.countryCode).toUpperCase() || null,
    source: cleanText(input.source) || 'manual',
    external_id: cleanText(input.externalId) || null,
    lead_fingerprint: leadFingerprint(input) || null,
    lead_state: input.state ?? 'assigned',
    notes: cleanText(input.notes) || null,
    metadata: input.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// Bulk helpers (for high-volume paths like CSV import)
// ---------------------------------------------------------------------------

export type BulkContactInput = {
  contactId: string;
  name: string;
  phone?: string | null;
  phoneE164?: string | null;
  email?: string | null;
  address?: string | null;
};

export type BulkMasterResult = {
  /** Phone E.164 values already claimed by a different rep in this workspace. */
  claimedPhones: Set<string>;
  /** Number of contacts successfully registered in the master list. */
  registeredCount: number;
};

/**
 * One-shot cross-rep collision check for a batch of contacts.
 * Returns the set of phone_e164 values that are already assigned to a DIFFERENT
 * user in this workspace — callers should drop those rows before importing.
 */
export async function findClaimedPhonesInWorkspace(
  admin: SupabaseAdmin,
  workspaceId: string,
  assignedUserId: string,
  phoneE164s: string[],
): Promise<Set<string>> {
  if (!phoneE164s.length) return new Set();

  const { data, error } = await admin
    .from('salesperson_lead_master')
    .select('phone_e164')
    .eq('workspace_id', workspaceId)
    .neq('assigned_user_id', assignedUserId)
    .in('phone_e164', phoneE164s);

  if (error) {
    if (isMissingMasterTable(error)) return new Set();
    console.warn('[sales-leads/master-list] bulk phone check failed', error);
    return new Set();
  }

  const claimed = new Set<string>();
  for (const row of data ?? []) {
    if (row.phone_e164) claimed.add(row.phone_e164);
  }
  return claimed;
}

/**
 * Bulk-upsert contacts into salesperson_lead_master after a CSV import.
 * Uses a direct batch insert with conflict-ignore so it stays at O(1) queries
 * instead of O(N*6) like the serial ensureSalespersonLeadMaster path.
 * Non-fatal — master list failures never block the import itself.
 */
export async function bulkRegisterContactsInMaster(
  admin: SupabaseAdmin,
  params: {
    workspaceId: string;
    assignedUserId: string;
    listName?: string | null;
    contacts: BulkContactInput[];
  },
): Promise<number> {
  if (!params.contacts.length) return 0;

  const rows = params.contacts.map((contact) => ({
    ...shapeMasterPayload({
      workspaceId: params.workspaceId,
      assignedUserId: params.assignedUserId,
      contactId: contact.contactId,
      name: contact.name,
      phone: contact.phoneE164 ?? contact.phone,
      email: contact.email,
      address: contact.address,
      source: 'csv_import',
      state: 'assigned' as const,
      metadata: params.listName ? { listName: params.listName } : {},
    }),
    // Override phone with pre-normalised E.164 when available so we don't
    // re-normalise and potentially diverge from what was already stored.
    phone_e164: contact.phoneE164 ?? null,
  }));

  // Chunk to stay within Supabase's default row limits per request.
  const CHUNK = 200;
  let registered = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await admin
      .from('salesperson_lead_master')
      .upsert(chunk, { onConflict: 'lead_fingerprint', ignoreDuplicates: true });

    if (error) {
      if (isMissingMasterTable(error)) return registered;
      console.warn('[sales-leads/master-list] bulk register failed', error);
      continue;
    }
    registered += chunk.length;
  }
  return registered;
}

export async function findSalespersonLeadMaster(
  admin: SupabaseAdmin,
  input: Pick<MasterLeadInput, 'workspaceId' | 'contactId' | 'diallerLeadId' | 'name' | 'phone' | 'email' | 'address' | 'source' | 'externalId'>
): Promise<MasterLeadResult> {
  const phoneE164 = normalizePhoneNumber(input.phone).e164 || null;
  const emailKey = normalizedEmail(input.email);
  const fingerprint = leadFingerprint(input);
  const lookups = [
    cleanText(input.diallerLeadId) ? { column: 'dialler_lead_id', value: cleanText(input.diallerLeadId) } : null,
    cleanText(input.contactId) ? { column: 'contact_id', value: cleanText(input.contactId) } : null,
    phoneE164 ? { column: 'phone_e164', value: phoneE164 } : null,
    emailKey ? { column: 'email_normalized', value: emailKey } : null,
    cleanText(input.source) && cleanText(input.externalId)
      ? { column: 'source_external', value: `${cleanText(input.source)}|${cleanText(input.externalId)}` }
      : null,
    fingerprint ? { column: 'lead_fingerprint', value: fingerprint } : null,
  ].filter((lookup): lookup is { column: string; value: string } => Boolean(lookup));

  for (const lookup of lookups) {
    let query = admin
      .from('salesperson_lead_master')
      .select('*')
      .eq('workspace_id', input.workspaceId)
      .limit(1);

    if (lookup.column === 'source_external') {
      const [source, externalId] = lookup.value.split('|');
      query = query.eq('source', source).eq('external_id', externalId);
    } else {
      query = query.eq(lookup.column, lookup.value);
    }

    const { data, error } = await query.maybeSingle();
    if (!error && data) {
      return { available: true, created: false, existing: true, row: data as SalespersonLeadMaster, warning: null };
    }
    if (error && error.code !== 'PGRST116') {
      if (isMissingMasterTable(error)) {
        return {
          available: false,
          created: false,
          existing: false,
          row: null,
          warning: 'Lead master list is not ready yet. Run the latest Supabase migration.',
        };
      }
      console.warn('[sales-leads/master-list] lookup failed', error);
    }
  }

  return { available: true, created: false, existing: false, row: null, warning: null };
}

export async function ensureSalespersonLeadMaster(
  admin: SupabaseAdmin,
  input: MasterLeadInput
): Promise<MasterLeadResult> {
  const existing = await findSalespersonLeadMaster(admin, input);
  if (!existing.available || existing.row) return existing;

  const { data, error } = await admin
    .from('salesperson_lead_master')
    .insert(shapeMasterPayload(input))
    .select('*')
    .single();

  if (!error && data) {
    return { available: true, created: true, existing: false, row: data as SalespersonLeadMaster, warning: null };
  }

  if (isMissingMasterTable(error)) {
    return {
      available: false,
      created: false,
      existing: false,
      row: null,
      warning: 'Lead master list is not ready yet. Run the latest Supabase migration.',
    };
  }

  const retry = await findSalespersonLeadMaster(admin, input);
  if (retry.row) return retry;

  console.warn('[sales-leads/master-list] insert failed', error);
  return {
    available: true,
    created: false,
    existing: false,
    row: null,
    warning: 'Could not save this lead to the master list.',
  };
}

export async function attachDiallerLeadToMaster(
  admin: SupabaseAdmin,
  masterId: string | null | undefined,
  diallerLeadId: string | null | undefined
): Promise<void> {
  const id = cleanText(masterId);
  const leadId = cleanText(diallerLeadId);
  if (!id || !leadId) return;

  const { error } = await admin
    .from('salesperson_lead_master')
    .update({ dialler_lead_id: leadId, lead_state: 'queued' })
    .eq('id', id);

  if (error && !isMissingMasterTable(error)) {
    console.warn('[sales-leads/master-list] failed to attach dialler lead', error);
  }
}

export async function incrementMasterLeadAttemptForDiallerLead(
  admin: SupabaseAdmin,
  lead: DiallerLead,
  attemptedAt: string,
  assignedSalespersonId?: string | null
): Promise<void> {
  const existing = await findSalespersonLeadMaster(admin, {
    workspaceId: lead.workspace_id,
    diallerLeadId: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
  });

  const row = existing.row ?? (
    await ensureSalespersonLeadMaster(admin, {
      workspaceId: lead.workspace_id,
      assignedUserId: lead.user_id,
      assignedSalespersonId,
      createdByUserId: lead.user_id,
      diallerLeadId: lead.id,
      name: lead.name,
      company: lead.company,
      phone: lead.phone,
      email: lead.email,
      source: 'dialler_leads',
      externalId: lead.id,
      state: 'queued',
      notes: lead.notes,
    })
  ).row;

  if (!row?.id) return;

  const { error } = await admin
    .from('salesperson_lead_master')
    .update({
      attempt_count: (row.attempt_count ?? 0) + 1,
      last_attempted_at: attemptedAt,
      lead_state: 'attempting',
    })
    .eq('id', row.id);

  if (error && !isMissingMasterTable(error)) {
    console.warn('[sales-leads/master-list] failed to increment attempt count', error);
  }
}

function diallerDispositionToMasterState(disposition: DiallerLeadDisposition): SalespersonLeadMasterState {
  switch (disposition) {
    case 'interested':
      return 'interested';
    case 'callback':
      return 'callback';
    case 'not_now':
      return 'not_now';
    case 'dnc':
      return 'dnc';
  }
}

function callDispositionToMasterState(disposition: DialerCallDisposition): SalespersonLeadMasterState {
  switch (disposition) {
    case 'connected':
    case 'appointment_set':
      return 'contacted';
    case 'callback_requested':
    case 'follow_up':
    case 'left_voicemail':
      return 'callback';
    case 'do_not_call':
      return 'dnc';
    case 'not_interested':
    case 'bad_number':
      return 'not_now';
    case 'no_answer':
      return 'no_answer';
  }
}

export async function updateMasterLeadDispositionForDiallerLead(params: {
  admin: SupabaseAdmin;
  lead: DiallerLead;
  disposition: DiallerLeadDisposition;
  notes?: string | null;
  nextFollowUpAt?: string | null;
}): Promise<void> {
  const existing = await findSalespersonLeadMaster(params.admin, {
    workspaceId: params.lead.workspace_id,
    diallerLeadId: params.lead.id,
    name: params.lead.name,
    phone: params.lead.phone,
    email: params.lead.email,
  });
  if (!existing.row?.id) return;

  const { error } = await params.admin
    .from('salesperson_lead_master')
    .update({
      lead_state: diallerDispositionToMasterState(params.disposition),
      disposition: params.disposition,
      notes: cleanText(params.notes) || params.lead.notes || null,
      next_follow_up_at: cleanText(params.nextFollowUpAt) || null,
    })
    .eq('id', existing.row.id);

  if (error && !isMissingMasterTable(error)) {
    console.warn('[sales-leads/master-list] failed to update dialler disposition', error);
  }
}

export async function updateMasterLeadDispositionForCall(params: {
  admin: SupabaseAdmin;
  workspaceId: string;
  diallerLeadId?: string | null;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  disposition: DialerCallDisposition;
  notes?: string | null;
  nextFollowUpAt?: string | null;
}): Promise<void> {
  const existing = await findSalespersonLeadMaster(params.admin, {
    workspaceId: params.workspaceId,
    diallerLeadId: params.diallerLeadId,
    name: params.name ?? 'Lead',
    phone: params.phone,
    email: params.email,
  });
  if (!existing.row?.id) return;

  const { error } = await params.admin
    .from('salesperson_lead_master')
    .update({
      lead_state: callDispositionToMasterState(params.disposition),
      disposition: params.disposition,
      notes: cleanText(params.notes) || existing.row.notes || null,
      next_follow_up_at: cleanText(params.nextFollowUpAt) || null,
    })
    .eq('id', existing.row.id);

  if (error && !isMissingMasterTable(error)) {
    console.warn('[sales-leads/master-list] failed to update call disposition', error);
  }
}
