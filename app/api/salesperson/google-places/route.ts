import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import {
  formatGooglePlacesSearchError,
  getPlacesApiKey,
  searchGooglePlacesLeadsForJobSignals,
  searchGooglePlacesLeads,
} from '@/lib/scraper/googlePlacesLeadSearch';
import type { PlacesLead } from '@/lib/scraper/googlePlacesLeadSearch';
import {
  searchD2DJobSignals,
} from '@/lib/scraper/d2dJobSignals';
import { normalizePhoneMarket, normalizePhoneNumber, type SupportedPhoneMarket } from '@/lib/dialer/phone';
import {
  attachDiallerLeadToMaster,
  ensureSalespersonLeadMaster,
  findSalespersonLeadMaster,
} from '@/lib/sales-leads/master-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  workspace_id: string | null;
};

type SavedScraperListResult = {
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

const requestSchema = z.object({
  city: z.string().trim().min(2).max(100),
  industry: z.string().trim().min(2).max(120),
  countryCode: z.string().trim().min(2).max(2).default('US'),
  region: z.string().trim().max(80).optional(),
  pageSize: z.number().int().min(1).max(20).default(12),
  relatedTerms: z.array(z.string().trim().min(2).max(120)).max(12).optional(),
  workspaceId: z.string().uuid().optional(),
  listName: z.string().trim().min(1).max(120).optional(),
  marketId: z.string().uuid().optional(),
  industryId: z.string().uuid().optional(),
  leadSource: z.enum(['places', 'job_signals']).default('places'),
  leadIntent: z.enum(['generic', 'real_estate_agents', 'real_estate_individual_agents', 'real_estate_teams', 'real_estate_brokerages']).default('generic'),
});

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

function formatListDate(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date());
}

function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizedPhoneKey(value: string | null | undefined, phoneMarket: SupportedPhoneMarket = 'US'): string {
  return normalizePhoneNumber(value, phoneMarket).e164 || String(value ?? '').replace(/\D/g, '');
}

function buildSavedListName(input: {
  city: string;
  industry: string;
  region?: string;
  leadSource?: 'places' | 'job_signals';
}): string {
  const location = compactWhitespace([input.city, input.region].filter(Boolean).join(', '));
  const industry = compactWhitespace(input.industry);
  const prefix = input.leadSource === 'job_signals' ? 'Hiring D2D' : '';
  const base = [prefix, location, industry].filter(Boolean).join(' - ');
  return `${base || 'Places leads'} - ${formatListDate()}`.slice(0, 120);
}

function contactSignature(lead: PlacesLead, phoneMarket: SupportedPhoneMarket = 'US'): string {
  const normalizedPhone = normalizePhoneNumber(lead.phone, phoneMarket).e164 || (lead.phone ?? '').trim();
  return [
    compactWhitespace(lead.name || 'Lead').toLowerCase(),
    normalizedPhone,
    compactWhitespace(lead.formattedAddress ?? '').toLowerCase(),
  ].join('|');
}

function scraperLeadKey(lead: PlacesLead, phoneMarket: SupportedPhoneMarket = 'US'): string {
  return normalizedPhoneKey(lead.phone, phoneMarket) || contactSignature(lead, phoneMarket);
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

async function saveScraperResults(params: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  salespersonId?: string | null;
  workspaceId: string | null;
  leads: PlacesLead[];
  city: string;
  industry: string;
  region?: string;
  countryCode: string;
  listName?: string;
  leadSource?: 'places' | 'job_signals';
}): Promise<SavedScraperListResult | null> {
  if (!params.workspaceId || params.leads.length === 0) return null;
  const workspaceId = params.workspaceId;
  const phoneMarket = normalizePhoneMarket(params.countryCode);

  const listName =
    params.listName?.trim().replace(/\s+/g, ' ').slice(0, 120) ||
    buildSavedListName({
      city: params.city,
      industry: params.industry,
      region: params.region,
      leadSource: params.leadSource,
    });
  let warning: string | null = null;

  const { data: existingContacts, error: existingContactsError } = await params.admin
    .from('contacts')
    .select('id, user_id, full_name, phone, phone_e164, email, address')
    .eq('workspace_id', workspaceId);

  if (existingContactsError) {
    console.warn('[salesperson/google-places] contact lookup failed', existingContactsError);
  }

  const existingContactIdBySignature = new Map<string, string>();
  const existingContactIdByPhone = new Map<string, string>();
  const currentUserContactIds = new Set<string>();
  for (const contact of existingContacts ?? []) {
    const contactId = typeof contact.id === 'string' ? contact.id : '';
    if (!contactId || (contact as { user_id?: unknown }).user_id !== params.userId) continue;

    currentUserContactIds.add(contactId);
    const signature = [
      compactWhitespace(String(contact.full_name ?? '')).toLowerCase(),
      String((contact as { phone_e164?: unknown }).phone_e164 ?? '').trim() || normalizePhoneNumber(contact.phone, phoneMarket).e164 || String(contact.phone ?? '').trim(),
      compactWhitespace(String(contact.address ?? '')).toLowerCase(),
    ].join('|');
    if (contactId) {
      existingContactIdBySignature.set(signature, contactId);
      const phoneKey = normalizedPhoneKey(contact.phone, phoneMarket);
      if (phoneKey) existingContactIdByPhone.set(phoneKey, contactId);
    }
  }

  const uniqueLeads = new Map<string, PlacesLead>();
  for (const lead of params.leads) {
    const signature = scraperLeadKey(lead, phoneMarket);
    if (!uniqueLeads.has(signature)) uniqueLeads.set(signature, lead);
  }

  const leadsToImport: PlacesLead[] = [];
  const leadsNeedingContact = new Map<string, PlacesLead>();
  const leadsForDialer = new Map<string, PlacesLead>();
  const masterIdByLeadKey = new Map<string, string>();
  const masterMetadataById = new Map<string, Record<string, unknown>>();
  const contactIds = new Set<string>();
  const contactIdByLeadKey = new Map<string, string>();
  let masterAddedCount = 0;
  let masterSkippedCount = 0;

  for (const lead of uniqueLeads.values()) {
    const leadKey = scraperLeadKey(lead, phoneMarket);
    const existingMaster = await findSalespersonLeadMaster(params.admin, {
      workspaceId,
      name: compactWhitespace(lead.name || 'Lead'),
      phone: lead.phone,
      address: lead.formattedAddress,
      source: params.leadSource === 'job_signals' ? 'd2d_job_signals' : 'google_places',
      externalId: lead.placeId || null,
    });

    if (!existingMaster.available) {
      warning = warning ?? existingMaster.warning;
      leadsToImport.push(lead);
      leadsNeedingContact.set(leadKey, lead);
      leadsForDialer.set(leadKey, lead);
      continue;
    }

    if (existingMaster.row) {
      masterSkippedCount += 1;
      if (masterBelongsToRequester(existingMaster.row, params.userId, params.salespersonId)) {
        masterIdByLeadKey.set(leadKey, existingMaster.row.id);
        masterMetadataById.set(existingMaster.row.id, {
          ...(existingMaster.row.metadata ?? {}),
          listName,
        });
        leadsForDialer.set(leadKey, lead);

        const existingOwnContactId =
          (existingMaster.row.contact_id && currentUserContactIds.has(existingMaster.row.contact_id)
            ? existingMaster.row.contact_id
            : null) ??
          existingContactIdBySignature.get(contactSignature(lead, phoneMarket)) ??
          existingContactIdByPhone.get(normalizedPhoneKey(lead.phone, phoneMarket));

        if (existingOwnContactId) {
          contactIds.add(existingOwnContactId);
          contactIdByLeadKey.set(leadKey, existingOwnContactId);
        } else {
          leadsNeedingContact.set(leadKey, lead);
        }
      }
      continue;
    }

    leadsToImport.push(lead);
    leadsNeedingContact.set(leadKey, lead);
    leadsForDialer.set(leadKey, lead);
  }

  const contactsToInsert = Array.from(leadsNeedingContact.values()).flatMap((lead) => {
    const signature = contactSignature(lead, phoneMarket);
    const existingId = existingContactIdBySignature.get(signature) ?? existingContactIdByPhone.get(normalizedPhoneKey(lead.phone, phoneMarket));
    if (existingId) {
      contactIds.add(existingId);
      contactIdByLeadKey.set(scraperLeadKey(lead, phoneMarket), existingId);
      return [];
    }

    const normalizedPhone = normalizePhoneNumber(lead.phone, phoneMarket);
    const jobSignals = (lead.jobSignals ?? []).slice(0, 3);
    return [{
      user_id: params.userId,
      workspace_id: workspaceId,
      full_name: compactWhitespace(lead.name || 'Lead'),
      phone: lead.phone || null,
      phone_e164: normalizedPhone.e164,
      phone_country_code: normalizedPhone.countryCode,
      phone_area_code: normalizedPhone.areaCode,
      phone_area_label: normalizedPhone.areaLabel,
      phone_last_validated_at: new Date().toISOString(),
      phone_validation_error: normalizedPhone.error,
      email: null,
      address: compactWhitespace(lead.formattedAddress ?? ''),
      status: 'new' as const,
      source: params.leadSource === 'job_signals' ? 'D2D job signal scraper' : 'Google Places scraper',
      tags: params.leadSource === 'job_signals' ? 'scraper, job signals, google places' : 'scraper, google places',
      notes: [
        jobSignals.length ? 'Hiring signals:' : '',
        ...jobSignals.map((signal) => `- ${signal.source}: ${signal.title} (${signal.url})`),
        lead.website ? `Website: ${lead.website}` : '',
        lead.googleMapsUrl ? `Google Maps: ${lead.googleMapsUrl}` : '',
        lead.rating ? `Rating: ${lead.rating}` : '',
        lead.query ? `Source query: ${lead.query}` : '',
      ].filter(Boolean).join('\n') || null,
    }];
  });

  // Sales/prospecting imports must stay out of regular FLYR contacts.
  contactsToInsert.length = 0;

  if (contactsToInsert.length > 0) {
    try {
      const insertedIds = await insertContactsWithFallback(params.admin, contactsToInsert);
      insertedIds.forEach((id) => contactIds.add(id));
      insertedIds.forEach((id, index) => {
        const lead = contactsToInsert[index];
        if (lead) {
          const key = scraperLeadKey({
            name: lead.full_name,
            phone: lead.phone ?? undefined,
            formattedAddress: lead.address,
          } as PlacesLead, phoneMarket);
          contactIdByLeadKey.set(key, id);
        }
      });
    } catch (insertError) {
      console.warn('[salesperson/google-places] contact insert failed', insertError);
      warning = 'Added dialer rows, but could not save the contacts list.';
    }
  }

  for (const lead of leadsToImport) {
    const leadKey = scraperLeadKey(lead, phoneMarket);
    const masterResult = await ensureSalespersonLeadMaster(params.admin, {
      workspaceId,
      assignedUserId: params.userId,
      assignedSalespersonId: params.salespersonId,
      createdByUserId: params.userId,
      contactId: contactIdByLeadKey.get(leadKey) ?? null,
      name: compactWhitespace(lead.name || 'Lead'),
      company: compactWhitespace(lead.name || '') || null,
      phone: normalizePhoneNumber(lead.phone, phoneMarket).e164 || lead.phone,
      email: null,
      website: lead.website,
      websiteDomain: lead.websiteDomain,
      address: lead.formattedAddress,
      city: params.city,
      region: params.region,
      countryCode: params.countryCode,
      source: params.leadSource === 'job_signals' ? 'd2d_job_signals' : 'google_places',
      externalId: lead.placeId || null,
      state: 'assigned',
      notes: lead.evidenceSummary ?? null,
      metadata: {
        leadSource: params.leadSource ?? 'places',
        listName,
        leadCategory: lead.leadCategory ?? null,
        primaryType: lead.primaryType ?? null,
        confidenceScore: lead.confidenceScore,
        googleMapsUrl: lead.googleMapsUrl ?? null,
        jobSignals: lead.jobSignals ?? [],
      },
    });

    if (!masterResult.available) {
      warning = warning ?? masterResult.warning;
    } else if (masterResult.created) {
      masterAddedCount += 1;
    } else if (masterResult.existing) {
      masterSkippedCount += 1;
    }

    if (masterResult.row?.id) {
      masterIdByLeadKey.set(leadKey, masterResult.row.id);
      masterMetadataById.set(masterResult.row.id, {
        ...(masterResult.row.metadata ?? {}),
        listName,
      });
    }
  }

  let listId: string | null = null;
  if (contactIds.size > 0) {
    const { data: createdList, error: listError } = await params.admin
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

    if (listError) {
      console.warn('[salesperson/google-places] smart list insert failed', listError);
      warning = `Saved leads, but could not create the "${listName}" list.`;
    } else {
      listId = String((createdList as { id?: unknown })?.id ?? '').trim() || null;
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
          console.warn('[salesperson/google-places] failed to attach lead list metadata', error);
        }
      })
    );
  }

  const dialableLeads = Array.from(leadsForDialer.values()).flatMap((lead) => {
    const normalizedPhone = normalizePhoneNumber(lead.phone, phoneMarket);
    if (!normalizedPhone.isValid || !normalizedPhone.e164) return [];
    const jobSignals = (lead.jobSignals ?? []).slice(0, 2);
    return [{
      workspace_id: workspaceId,
      user_id: params.userId,
      name: compactWhitespace(lead.name || 'Lead'),
      phone: normalizedPhone.e164,
      phone_e164: normalizedPhone.e164,
      phone_country_code: normalizedPhone.countryCode,
      phone_area_code: normalizedPhone.areaCode,
      phone_area_label: normalizedPhone.areaLabel,
      company: compactWhitespace(lead.name || '') || null,
      email: null,
      disposition: null,
      notes: lead.website || lead.googleMapsUrl
        ? [
            `List: ${listName}`,
            ...jobSignals.map((signal) => `Hiring signal: ${signal.source} - ${signal.title} (${signal.url})`),
            lead.website ? `Website: ${lead.website}` : '',
            lead.googleMapsUrl ? `Maps: ${lead.googleMapsUrl}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : [`List: ${listName}`, ...jobSignals.map((signal) => `Hiring signal: ${signal.source} - ${signal.title} (${signal.url})`)]
            .filter(Boolean)
            .join('\n'),
      called_at: null,
      master_lead_id: masterIdByLeadKey.get(scraperLeadKey(lead, phoneMarket)) ?? null,
    }];
  });

  let dialerImportedCount = 0;
  let dialerSkippedCount = 0;
  const dialerLeadIds: string[] = [];
  // sales_leads is now the dialer queue for salesperson/prospecting leads.
  if (false && dialableLeads.length > 0) {
    const { data: existingDialerRows, error: existingDialerError } = await params.admin
      .from('sales_leads')
      .select('id, phone')
      .eq('workspace_id', workspaceId)
      .eq('user_id', params.userId);

    if (existingDialerError) {
      console.warn('[salesperson/google-places] dialer lookup failed', existingDialerError);
      warning = warning ?? 'Saved the list, but could not check existing dialer leads.';
    } else {
      const existingIdByPhone = new Map(
        (existingDialerRows ?? [])
          .map((row) => [
            normalizePhoneNumber(row.phone, phoneMarket).e164 || String(row.phone ?? '').trim(),
            String((row as { id?: unknown }).id ?? '').trim(),
          ] as const)
          .filter(([phone, id]) => Boolean(phone && id))
      );
      const existingPhones = new Set(
        Array.from(existingIdByPhone.keys())
          .filter(Boolean)
      );
      const dialerInserts = dialableLeads.filter((lead) => {
        const normalized = normalizePhoneNumber(lead.phone, phoneMarket).e164 || lead.phone.trim();
        if (existingPhones.has(normalized)) {
          dialerSkippedCount += 1;
          const existingId = existingIdByPhone.get(normalized);
          if (existingId) dialerLeadIds.push(existingId);
          return false;
        }
        existingPhones.add(normalized);
        return true;
      });

      // sales_leads is now the dialer queue for salesperson/prospecting leads.
      dialerInserts.length = 0;

      if (dialerInserts.length > 0) {
        const masterIdByPhone = new Map(
          dialerInserts
            .map((lead) => [
              normalizePhoneNumber(lead.phone, phoneMarket).e164 || lead.phone.trim(),
              (lead as { master_lead_id?: string | null }).master_lead_id ?? null,
            ] as const)
            .filter(([phone, masterId]) => Boolean(phone && masterId))
        );
        const insertPayload = dialerInserts.map((lead) => {
          const payload = { ...lead };
          delete (payload as { master_lead_id?: string | null }).master_lead_id;
          return payload;
        });
        const { data: insertedDialerRows, error: dialerInsertError } = await params.admin
          .from('sales_leads')
          .insert(insertPayload)
          .select('id, phone');

        if (dialerInsertError) {
          console.warn('[salesperson/google-places] dialer insert failed', dialerInsertError);
          warning = warning ?? 'Saved the list, but could not add leads to the dialer queue.';
        } else {
          dialerImportedCount = insertedDialerRows?.length ?? dialerInserts.length;
          for (const row of insertedDialerRows ?? []) {
            const id = String((row as { id?: unknown }).id ?? '').trim();
            if (id) dialerLeadIds.push(id);
            const phone = normalizePhoneNumber((row as { phone?: unknown }).phone as string | undefined, phoneMarket).e164
              || String((row as { phone?: unknown }).phone ?? '').trim();
            await attachDiallerLeadToMaster(params.admin, masterIdByPhone.get(phone), id);
          }
        }
      }
    }
  }

  const contactIdList = Array.from(contactIds);
  return {
    listId,
    listName,
    contactIds: contactIdList,
    contactCount: contactIdList.length,
    dialerLeadIds,
    dialerImportedCount,
    dialerSkippedCount,
    masterAddedCount,
    masterSkippedCount,
    warning,
  };
}

async function recordProspectSearchRun(params: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  workspaceId: string | null;
  marketId?: string;
  industryId?: string;
  city: string;
  region?: string;
  countryCode: string;
  industry: string;
  queryTerms: string[];
  startedAt: string;
  completedAt: string;
  queryCount: number;
  rawCount: number;
  uniqueCount: number;
  savedList: SavedScraperListResult | null;
  leads: PlacesLead[];
}): Promise<void> {
  if (!params.workspaceId) return;

  const { data: run, error: runError } = await params.admin
    .from('prospect_search_runs')
    .insert({
      workspace_id: params.workspaceId,
      user_id: params.userId,
      market_id: params.marketId ?? null,
      industry_id: params.industryId ?? null,
      city: compactWhitespace(params.city),
      region: params.region ? compactWhitespace(params.region) : null,
      country_code: params.countryCode.toUpperCase(),
      industry: compactWhitespace(params.industry),
      query_terms: params.queryTerms,
      query_count: params.queryCount,
      raw_count: params.rawCount,
      unique_count: params.uniqueCount,
      saved_count: params.savedList?.contactCount ?? 0,
      dialer_count: params.savedList?.dialerLeadIds.length ?? 0,
      status: 'completed',
      started_at: params.startedAt,
      completed_at: params.completedAt,
    })
    .select('id')
    .single();

  if (runError || !run) {
    console.warn('[salesperson/google-places] prospect run insert failed', runError);
    return;
  }

  const runId = String((run as { id?: unknown }).id ?? '').trim();
  if (!runId || params.leads.length === 0) return;

  const rows = params.leads.slice(0, 500).map((lead) => ({
    run_id: runId,
    workspace_id: params.workspaceId,
    place_id: lead.placeId || null,
    business_name: compactWhitespace(lead.name || 'Lead'),
    phone: lead.phone || null,
    website: lead.website || null,
    formatted_address: lead.formattedAddress || null,
    score: lead.confidenceScore,
    was_saved: (params.savedList?.contactCount ?? 0) > 0,
    was_added_to_dialer: (params.savedList?.dialerLeadIds.length ?? 0) > 0,
  }));

  const { error: resultsError } = await params.admin
    .from('prospect_search_run_results')
    .insert(rows);

  if (resultsError) {
    console.warn('[salesperson/google-places] prospect run results insert failed', resultsError);
  }
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = getPlacesApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'Google Places is not configured. Set GOOGLE_PLACES_API_KEY on the server, or GOOGLE_API_KEY as a fallback.',
      },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { error: firstIssue?.message ?? 'Invalid Google Places search settings.' },
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
        { error: 'Salesperson access is required for Places lead search.' },
        { status: 403 }
      );
    }

    const workspaceId = await resolveWorkspaceIdForSearch({
      admin,
      requestUser,
      salesperson,
      requestedWorkspaceId: parsed.data.workspaceId,
    });

    const jobSignalResult = parsed.data.leadSource === 'job_signals'
      ? await searchD2DJobSignals({
          city: parsed.data.city,
          region: parsed.data.region,
          countryCode: parsed.data.countryCode,
          industry: parsed.data.industry,
          limit: parsed.data.pageSize,
        })
      : null;
    const result = jobSignalResult
      ? await searchGooglePlacesLeadsForJobSignals(
          {
            apiKey,
            city: parsed.data.city,
            industry: parsed.data.industry,
            countryCode: parsed.data.countryCode,
            region: parsed.data.region,
            pageSize: parsed.data.pageSize,
            leadIntent: parsed.data.leadIntent,
            includedType: parsed.data.leadIntent === 'generic' ? undefined : 'real_estate_agency',
          },
          jobSignalResult.signals
        )
      : await searchGooglePlacesLeads({
          apiKey,
          city: parsed.data.city,
          industry: parsed.data.industry,
          countryCode: parsed.data.countryCode,
          region: parsed.data.region,
          pageSize: parsed.data.pageSize,
          leadIntent: parsed.data.leadIntent,
          includedType: parsed.data.leadIntent === 'generic' ? undefined : 'real_estate_agency',
          relatedTerms: parsed.data.relatedTerms,
        });
    const savedList = await saveScraperResults({
      admin,
      userId: requestUser.id,
      salespersonId: salesperson?.id ?? null,
      workspaceId,
      leads: result.prospects,
      city: parsed.data.city,
      industry: parsed.data.industry,
      region: parsed.data.region,
      countryCode: parsed.data.countryCode,
      listName: parsed.data.listName,
      leadSource: parsed.data.leadSource,
    });
    await recordProspectSearchRun({
      admin,
      userId: requestUser.id,
      workspaceId,
      marketId: parsed.data.marketId,
      industryId: parsed.data.industryId,
      city: parsed.data.city,
      region: parsed.data.region,
      countryCode: parsed.data.countryCode,
      industry: parsed.data.industry,
      queryTerms: jobSignalResult
        ? jobSignalResult.queries
        : result.queryPreview.map((query) => query.industry),
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      queryCount: result.queryCount + (jobSignalResult?.queries.length ?? 0),
      rawCount: result.rawResultCount + (jobSignalResult?.rawResultCount ?? 0),
      uniqueCount: result.uniqueResultCount,
      savedList,
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
      savedList,
      jobSignalCount: jobSignalResult?.signals.length ?? 0,
      jobSignalRawCount: jobSignalResult?.rawResultCount ?? 0,
      jobSignalProvider: jobSignalResult?.provider ?? null,
      leadSource: parsed.data.leadSource,
      ...result,
    });
  } catch (error) {
    console.error('[api/salesperson/google-places] POST error:', error);
    const message = formatGooglePlacesSearchError(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
