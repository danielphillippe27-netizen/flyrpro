import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import {
  attachDiallerLeadToMaster,
  ensureSalespersonLeadMaster,
  findSalespersonLeadMaster,
} from '@/lib/sales-leads/master-list';
import { createAdminClient } from '@/lib/supabase/server';
import { scrapeReiqLeads, type ReiqLead } from '@/lib/scraper/reiqLeadSearch';
import { scrapeReinswLeads } from '@/lib/scraper/reinswLeadSearch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  workspace_id: string | null;
};

type SavedReiqList = {
  listId: string | null;
  listName: string;
  contactIds: string[];
  contactCount: number;
  dialerLeadIds: string[];
  dialerImportedCount: number;
  dialerSkippedCount: number;
  masterAddedCount: number;
  masterSkippedCount: number;
  warning: string | null;
};

type ContactInsert = {
  user_id: string;
  workspace_id: string;
  full_name: string;
  phone?: string | null;
  phone_e164?: string | null;
  phone_country_code?: string | null;
  phone_area_code?: string | null;
  phone_area_label?: string | null;
  phone_last_validated_at?: string;
  phone_validation_error?: string | null;
  email?: string | null;
  address: string;
  status: 'new';
  source?: string;
  tags?: string;
  notes?: string | null;
};

const OPTIONAL_CONTACT_INSERT_COLUMNS = [
  'source',
  'tags',
  'phone_e164',
  'phone_country_code',
  'phone_area_code',
  'phone_area_label',
  'phone_last_validated_at',
  'phone_validation_error',
] as const;
const REIQ_INTERACTIVE_PROFILE_LIMIT = 250;
const REINSW_INTERACTIVE_PROFILE_LIMIT = 500;

const requestSchema = z.object({
  source: z.enum(['reiq', 'reinsw']).default('reiq'),
  startUrl: z.string().trim().url().optional(),
  location: z.string().trim().min(2).max(120).optional(),
  maxPages: z.number().int().min(1).max(25).optional(),
  maxProfiles: z.number().int().min(1).max(5000).optional(),
  delayMs: z.number().int().min(0).max(10_000).default(250),
  workspaceId: z.string().uuid().optional(),
  listName: z.string().trim().min(1).max(120).optional(),
}).superRefine((value, ctx) => {
  if (value.source === 'reiq') {
    if (!value.startUrl || !value.startUrl.includes('members.reiq.com')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startUrl'],
        message: 'Enter a REIQ members search or profile URL.',
      });
    }
    return;
  }

  if (!value.location) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['location'],
      message: 'Enter a NSW city.',
    });
  }
});

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function formatListDate(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date());
}

function buildListName(location: string | null | undefined, sourceLabel = 'REIQ'): string {
  return `${cleanText(location) || 'Australia'} ${sourceLabel} leads - ${formatListDate()}`.slice(0, 120);
}

function phoneKey(value: string | null | undefined): string {
  return normalizePhoneNumber(value, 'AU').e164 || String(value ?? '').replace(/\D/g, '');
}

function leadKey(lead: ReiqLead): string {
  return phoneKey(lead.phone) || cleanText(lead.email).toLowerCase() || cleanText(lead.sourceUrl || lead.placeId);
}

function masterBelongsToRequester(
  row: { assigned_user_id?: string | null; assigned_salesperson_id?: string | null },
  userId: string,
  salespersonId?: string | null
): boolean {
  return row.assigned_user_id === userId || Boolean(salespersonId && row.assigned_salesperson_id === salespersonId);
}

function isMissingContactsColumn(error: unknown, column: string): boolean {
  if (!error || typeof error !== 'object' || !('message' in error)) return false;
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return (
    message.includes(`column contacts.${column}`) ||
    message.includes(`column "${column}"`) ||
    message.includes(`${column} does not exist`) ||
    message.includes(`could not find the '${column}' column`)
  );
}

async function insertContactsWithFallback(
  admin: ReturnType<typeof createAdminClient>,
  rows: ContactInsert[]
): Promise<string[]> {
  let payload = rows.map((row) => ({ ...row }));

  while (true) {
    const { data, error } = await admin.from('contacts').insert(payload).select('id');
    if (!error) {
      return (data ?? [])
        .map((row) => String((row as { id?: unknown }).id ?? '').trim())
        .filter(Boolean);
    }

    const missingColumn = OPTIONAL_CONTACT_INSERT_COLUMNS.find((column) => isMissingContactsColumn(error, column));
    if (!missingColumn) throw error;

    payload = payload.map((row) => {
      const nextRow = { ...row } as Partial<ContactInsert>;
      delete nextRow[missingColumn];
      return nextRow as ContactInsert;
    });
  }
}

async function resolveSalesperson(
  admin: ReturnType<typeof createAdminClient>,
  email: string | null
): Promise<SalespersonRow | null> {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const { data, error } = await admin
    .from('salespeople')
    .select('id, full_name, email, workspace_id')
    .eq('email', normalizedEmail)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalespersonRow | null) ?? null;
}

async function isFounderUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('user_id, is_founder')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean((data as { is_founder?: boolean | null } | null)?.is_founder);
}

async function resolveWorkspaceIdForSearch(params: {
  admin: ReturnType<typeof createAdminClient>;
  requestUser: { id: string };
  salesperson: SalespersonRow | null;
  requestedWorkspaceId?: string | null;
}): Promise<string | null> {
  if (params.requestedWorkspaceId) {
    const requestedResolution = await resolveWorkspaceIdForUser(
      params.admin as unknown as MinimalSupabaseClient,
      params.requestUser.id,
      params.requestedWorkspaceId
    );
    if (requestedResolution.workspaceId) return requestedResolution.workspaceId;
  }

  if (params.salesperson?.workspace_id) return params.salesperson.workspace_id;

  const resolution = await resolveWorkspaceIdForUser(
    params.admin as unknown as MinimalSupabaseClient,
    params.requestUser.id,
    params.requestedWorkspaceId ?? null
  );

  return resolution.workspaceId;
}

async function loadExistingLeadExternalIds(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string | null;
  source: 'australia_reiq' | 'australia_reinsw';
}): Promise<Set<string>> {
  const externalIds = new Set<string>();
  if (!params.workspaceId) return externalIds;

  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await params.admin
      .from('sales_leads')
      .select('external_id')
      .eq('workspace_id', params.workspaceId)
      .eq('source', params.source)
      .range(from, from + pageSize - 1);

    if (error) {
      console.warn('[salesperson/reiq] existing lead external id lookup failed', error);
      return externalIds;
    }

    const rows = data ?? [];
    for (const row of rows) {
      const externalId = cleanText((row as { external_id?: unknown }).external_id);
      if (externalId) externalIds.add(externalId);
    }

    if (rows.length < pageSize) break;
  }

  return externalIds;
}

async function saveReiqLeads(params: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  salespersonId?: string | null;
  workspaceId: string | null;
  listName?: string;
  location?: string;
  sourceKey?: 'australia_reiq' | 'australia_reinsw';
  sourceLabel?: string;
  sourceTags?: string;
  leads: ReiqLead[];
}): Promise<SavedReiqList | null> {
  if (!params.workspaceId || params.leads.length === 0) return null;

  const workspaceId = params.workspaceId;
  const sourceKey = params.sourceKey ?? 'australia_reiq';
  const sourceLabel = params.sourceLabel ?? 'REIQ';
  const sourceTags = params.sourceTags ?? 'scraper, reiq, australia';
  const listName = cleanText(params.listName).slice(0, 120) || buildListName(params.location, sourceLabel);
  let warning: string | null = null;

  const uniqueLeads = new Map<string, ReiqLead>();
  for (const lead of params.leads) {
    const key = leadKey(lead);
    if (key && !uniqueLeads.has(key)) uniqueLeads.set(key, lead);
  }

  const { data: existingContacts, error: existingContactsError } = await params.admin
    .from('contacts')
    .select('id, user_id, phone, phone_e164, email')
    .eq('workspace_id', workspaceId);

  if (existingContactsError) {
    console.warn('[salesperson/reiq] contact lookup failed', existingContactsError);
  }

  const contactIdByPhone = new Map<string, string>();
  const contactIdByEmail = new Map<string, string>();
  const currentUserContactIds = new Set<string>();
  for (const contact of existingContacts ?? []) {
    const id = cleanText((contact as { id?: unknown }).id);
    if (!id || (contact as { user_id?: unknown }).user_id !== params.userId) continue;

    currentUserContactIds.add(id);
    const phone = cleanText((contact as { phone_e164?: unknown }).phone_e164) || phoneKey(String((contact as { phone?: unknown }).phone ?? ''));
    const email = cleanText((contact as { email?: unknown }).email).toLowerCase();
    if (phone) contactIdByPhone.set(phone, id);
    if (email) contactIdByEmail.set(email, id);
  }

  const leadsToImport: ReiqLead[] = [];
  const leadsNeedingContact = new Map<string, ReiqLead>();
  const leadsForDialer = new Map<string, ReiqLead>();
  const contactIds = new Set<string>();
  const contactIdByLeadKey = new Map<string, string>();
  const masterIdByLeadKey = new Map<string, string>();
  const masterMetadataById = new Map<string, Record<string, unknown>>();
  let masterAddedCount = 0;
  let masterSkippedCount = 0;

  for (const lead of uniqueLeads.values()) {
    const key = leadKey(lead);
    const existingMaster = await findSalespersonLeadMaster(params.admin, {
      workspaceId,
      name: cleanText(lead.name || `${sourceLabel} lead`),
      phone: lead.phone,
      email: cleanText(lead.email) || null,
      address: lead.formattedAddress,
      source: sourceKey,
      externalId: cleanText(lead.sourceUrl || lead.placeId) || null,
    });

    if (!existingMaster.available) {
      warning = warning ?? existingMaster.warning;
      leadsToImport.push(lead);
      leadsNeedingContact.set(key, lead);
      leadsForDialer.set(key, lead);
      continue;
    }

    if (existingMaster.row) {
      masterSkippedCount += 1;
      if (masterBelongsToRequester(existingMaster.row, params.userId, params.salespersonId)) {
        masterIdByLeadKey.set(key, existingMaster.row.id);
        masterMetadataById.set(existingMaster.row.id, {
          ...(existingMaster.row.metadata ?? {}),
          listName,
        });
        leadsForDialer.set(key, lead);

        const phone = phoneKey(lead.phone);
        const email = cleanText(lead.email).toLowerCase();
        const existingOwnContactId =
          (existingMaster.row.contact_id && currentUserContactIds.has(existingMaster.row.contact_id)
            ? existingMaster.row.contact_id
            : null) ??
          (phone ? contactIdByPhone.get(phone) : undefined) ??
          (email ? contactIdByEmail.get(email) : undefined);

        if (existingOwnContactId) {
          contactIds.add(existingOwnContactId);
          contactIdByLeadKey.set(key, existingOwnContactId);
        } else {
          leadsNeedingContact.set(key, lead);
        }
      }
      continue;
    }

    leadsToImport.push(lead);
    leadsNeedingContact.set(key, lead);
    leadsForDialer.set(key, lead);
  }

  const contactsToInsert: ContactInsert[] = Array.from(leadsNeedingContact.values()).flatMap((lead) => {
    const key = leadKey(lead);
    const existingContactId =
      contactIdByPhone.get(phoneKey(lead.phone)) ||
      contactIdByEmail.get(cleanText(lead.email).toLowerCase());
    if (existingContactId) {
      contactIds.add(existingContactId);
      contactIdByLeadKey.set(key, existingContactId);
      return [];
    }

    const normalized = normalizePhoneNumber(lead.phone, 'AU');
    return [{
      user_id: params.userId,
      workspace_id: workspaceId,
      full_name: cleanText(lead.name || `${sourceLabel} lead`),
      phone: lead.phone || null,
      phone_e164: normalized.e164 || null,
      phone_country_code: normalized.countryCode || null,
      phone_area_code: normalized.areaCode || null,
      phone_area_label: normalized.areaLabel || null,
      phone_last_validated_at: new Date().toISOString(),
      phone_validation_error: normalized.error || null,
      email: cleanText(lead.email) || null,
      address: cleanText(lead.formattedAddress),
      status: 'new',
      source: `${sourceLabel} scraper`,
      tags: sourceTags,
      notes: [
        lead.agencyBusinessName ? `Agency: ${cleanText(lead.agencyBusinessName)}` : '',
        lead.classification ? `Classification: ${cleanText(lead.classification)}` : '',
        lead.sourceUrl ? `Source: ${cleanText(lead.sourceUrl)}` : '',
      ].filter(Boolean).join('\n') || null,
    }];
  });

  // Sales/prospecting imports must stay out of regular WolfGrid contacts.
  contactsToInsert.length = 0;

  if (contactsToInsert.length > 0) {
    try {
      const insertedIds = await insertContactsWithFallback(params.admin, contactsToInsert);
      insertedIds.forEach((id) => contactIds.add(id));
      insertedIds.forEach((id, index) => {
        const inserted = contactsToInsert[index];
        if (!inserted) return;
        const phone = phoneKey(inserted.phone);
        const email = cleanText(inserted.email).toLowerCase();
        for (const lead of uniqueLeads.values()) {
          if ((phone && phone === phoneKey(lead.phone)) || (email && email === cleanText(lead.email).toLowerCase())) {
            contactIdByLeadKey.set(leadKey(lead), id);
          }
        }
      });
    } catch (insertError) {
      console.warn('[salesperson/reiq] contact insert failed', insertError);
      warning = 'Added master leads where possible, but could not save all contact rows.';
    }
  }

  for (const lead of leadsToImport) {
    const normalized = normalizePhoneNumber(lead.phone, 'AU');
    const key = leadKey(lead);
    const master = await ensureSalespersonLeadMaster(params.admin, {
      workspaceId,
      assignedUserId: params.userId,
      assignedSalespersonId: params.salespersonId,
      createdByUserId: params.userId,
      contactId: contactIdByLeadKey.get(key) ?? null,
      name: cleanText(lead.name || `${sourceLabel} lead`),
      company: cleanText(lead.agencyBusinessName) || null,
      phone: normalized.e164 || lead.phone,
      email: cleanText(lead.email) || null,
      website: cleanText(lead.website) || null,
      websiteDomain: cleanText(lead.websiteDomain) || null,
      address: cleanText(lead.formattedAddress),
      city: cleanText(lead.suburbCity || lead.city),
      region: cleanText(lead.state),
      countryCode: 'AU',
      source: sourceKey,
      externalId: cleanText(lead.sourceUrl || lead.placeId) || null,
      state: 'assigned',
      notes: lead.evidenceSummary ?? null,
      metadata: {
        listName,
        classification: cleanText(lead.classification) || null,
        agencyBusinessName: cleanText(lead.agencyBusinessName) || null,
        sourceUrl: cleanText(lead.sourceUrl) || null,
        confidenceScore: lead.confidenceScore ?? null,
      },
    });

    if (!master.available) {
      warning = warning ?? master.warning;
    } else if (master.created) {
      masterAddedCount += 1;
    } else if (master.existing) {
      masterSkippedCount += 1;
    }

    if (master.row?.id) {
      masterIdByLeadKey.set(key, master.row.id);
      masterMetadataById.set(master.row.id, {
        ...(master.row.metadata ?? {}),
        listName,
      });
    }
  }

  let listId: string | null = null;
  if (contactIds.size > 0) {
    const { data: createdList, error } = await params.admin
      .from('smart_lists')
      .insert({
        workspace_id: workspaceId,
        created_by_user_id: params.userId,
        name: listName,
        criteria: {
          baseKind: 'custom',
          source: '',
          tags: [],
          campaignIds: [],
          farmIds: [],
          contactIds: Array.from(contactIds),
        },
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[salesperson/reiq] smart list insert failed', error);
      warning = warning ?? `Saved leads, but could not create the "${listName}" list.`;
    } else {
      listId = cleanText((createdList as { id?: unknown })?.id) || null;
    }
  }

  if (masterMetadataById.size > 0) {
    await Promise.all(
      Array.from(masterMetadataById.entries()).map(async ([masterId, metadata]) => {
      const { error } = await params.admin
          .from('sales_leads')
          .update({
            metadata: {
              ...metadata,
              listId,
              listName,
            },
          })
          .eq('id', masterId);

        if (error) {
          console.warn('[salesperson/reiq] failed to attach lead list metadata', error);
        }
      })
    );
  }

  const { data: existingDialerRows, error: existingDialerError } = await params.admin
    .from('sales_leads')
    .select('id, phone')
    .eq('workspace_id', workspaceId)
    .eq('user_id', params.userId);

  let dialerImportedCount = 0;
  let dialerSkippedCount = 0;
  const dialerLeadIds: string[] = [];

  if (existingDialerError) {
    console.warn('[salesperson/reiq] dialer lookup failed', existingDialerError);
    warning = warning ?? 'Saved the list, but could not check existing dialer leads.';
  } else {
    const existingDialerIdByPhone = new Map(
      (existingDialerRows ?? [])
        .map((row) => [
          phoneKey(String((row as { phone?: unknown }).phone ?? '')),
          cleanText((row as { id?: unknown }).id),
        ] as const)
        .filter(([phone, id]) => Boolean(phone && id))
    );
    const seenDialerPhones = new Set(existingDialerIdByPhone.keys());
    const dialerInserts = Array.from(leadsForDialer.values()).flatMap((lead) => {
      const normalized = normalizePhoneNumber(lead.phone, 'AU');
      const key = normalized.e164 || phoneKey(lead.phone);
      if (!normalized.isValid || !key) return [];
      if (seenDialerPhones.has(key)) {
        dialerSkippedCount += 1;
        const existingId = existingDialerIdByPhone.get(key);
        if (existingId) dialerLeadIds.push(existingId);
        return [];
      }
      seenDialerPhones.add(key);
      return [{
        workspace_id: workspaceId,
        user_id: params.userId,
        name: cleanText(lead.name || `${sourceLabel} lead`),
        phone: normalized.e164 || lead.phone,
        phone_e164: normalized.e164 || null,
        phone_country_code: normalized.countryCode || null,
        phone_area_code: normalized.areaCode || null,
        phone_area_label: normalized.areaLabel || null,
        company: cleanText(lead.agencyBusinessName) || null,
        email: cleanText(lead.email) || null,
        disposition: null,
        notes: [
          `List: ${listName}`,
          lead.classification ? `Classification: ${cleanText(lead.classification)}` : '',
          lead.sourceUrl ? `Source: ${cleanText(lead.sourceUrl)}` : '',
        ].filter(Boolean).join('\n'),
        called_at: null,
        master_lead_id: masterIdByLeadKey.get(leadKey(lead)) ?? null,
      }];
    });

    // sales_leads is now the dialer queue for salesperson/prospecting leads.
    dialerInserts.length = 0;

    if (dialerInserts.length > 0) {
      const masterIdByDialerPhone = new Map(
        dialerInserts
          .map((lead) => [phoneKey(lead.phone), lead.master_lead_id] as const)
          .filter(([phone, masterId]) => Boolean(phone && masterId))
      );
      const insertPayload = dialerInserts.map((lead) => {
        const payload = { ...lead };
        delete (payload as { master_lead_id?: string | null }).master_lead_id;
        return payload;
      });
      const { data: insertedDialerRows, error } = await params.admin
        .from('sales_leads')
        .insert(insertPayload)
        .select('id, phone');

      if (error) {
        console.warn('[salesperson/reiq] dialer insert failed', error);
        warning = warning ?? 'Saved the list, but could not add leads to the dialer queue.';
      } else {
        dialerImportedCount = insertedDialerRows?.length ?? dialerInserts.length;
        for (const row of insertedDialerRows ?? []) {
          const id = cleanText((row as { id?: unknown }).id);
          if (id) dialerLeadIds.push(id);
          const key = phoneKey(String((row as { phone?: unknown }).phone ?? ''));
          await attachDiallerLeadToMaster(params.admin, masterIdByDialerPhone.get(key), id);
        }
      }
    }
  }

  return {
    listId,
    listName,
    contactIds: Array.from(contactIds),
    contactCount: contactIds.size,
    dialerLeadIds,
    dialerImportedCount,
    dialerSkippedCount,
    masterAddedCount,
    masterSkippedCount,
    warning,
  };
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { error: firstIssue?.message ?? 'Invalid Australia scraper settings.' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  try {
    const [salesperson, isFounder] = await Promise.all([
      resolveSalesperson(admin, requestUser.email),
      isFounderUser(admin, requestUser.id),
    ]);

    if (!salesperson && !isFounder) {
      return NextResponse.json(
        { error: 'Salesperson access is required for Australia lead search.' },
        { status: 403 }
      );
    }

    const workspaceId = await resolveWorkspaceIdForSearch({
      admin,
      requestUser,
      salesperson,
      requestedWorkspaceId: parsed.data.workspaceId,
    });

    const sourceKey = parsed.data.source === 'reinsw' ? 'australia_reinsw' : 'australia_reiq';
    const sourceLabel = parsed.data.source === 'reinsw' ? 'REINSW' : 'REIQ';
    const maxProfiles =
      parsed.data.source === 'reinsw'
        ? Math.min(parsed.data.maxProfiles ?? REINSW_INTERACTIVE_PROFILE_LIMIT, REINSW_INTERACTIVE_PROFILE_LIMIT)
        : Math.min(parsed.data.maxProfiles ?? REIQ_INTERACTIVE_PROFILE_LIMIT, REIQ_INTERACTIVE_PROFILE_LIMIT);
    const existingExternalIds = await loadExistingLeadExternalIds({
      admin,
      workspaceId,
      source: sourceKey,
    });
    const result =
      parsed.data.source === 'reinsw'
        ? await scrapeReinswLeads({
            location: parsed.data.location ?? 'Sydney',
            maxPages: parsed.data.maxPages ?? 10,
            maxProfiles,
            delayMs: parsed.data.delayMs ?? 150,
          })
        : await scrapeReiqLeads({
            startUrl: parsed.data.startUrl ?? '',
            location: parsed.data.location,
            maxPages: parsed.data.maxPages ?? 10,
            maxProfiles,
            delayMs: parsed.data.delayMs,
            excludeSourceUrls: Array.from(existingExternalIds),
          });
    const savedList = await saveReiqLeads({
      admin,
      userId: requestUser.id,
      salespersonId: salesperson?.id ?? null,
      workspaceId,
      listName: parsed.data.listName,
      location: parsed.data.location,
      sourceKey,
      sourceLabel,
      sourceTags: parsed.data.source === 'reinsw' ? 'scraper, reinsw, nsw, australia' : 'scraper, reiq, qld, australia',
      leads: result.prospects,
    });

    return NextResponse.json({
      ok: true,
      salesperson: salesperson
        ? {
            id: salesperson.id,
            fullName: salesperson.full_name,
            email: salesperson.email,
            workspaceId,
          }
        : null,
      leadSource: sourceKey,
      savedList,
      ...result,
    });
  } catch (error) {
    console.error('[api/salesperson/reiq] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Australia lead search failed.' },
      { status: 500 }
    );
  }
}
