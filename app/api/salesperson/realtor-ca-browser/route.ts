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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  workspace_id: string | null;
};

type SavedBrowserCaptureList = {
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

const leadSchema = z.object({
  placeId: z.string().optional().nullable(),
  name: z.string().trim().min(1).max(180),
  phone: z.string().trim().min(7).max(40),
  mobilePhone: z.string().optional().nullable(),
  workPhone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  websiteDomain: z.string().optional().nullable(),
  formattedAddress: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  office: z.string().optional().nullable(),
  agencyBusinessName: z.string().optional().nullable(),
  classification: z.string().optional().nullable(),
  confidenceScore: z.number().optional().nullable(),
});

const requestSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  listName: z.string().trim().min(1).max(120).optional(),
  city: z.string().trim().min(1).max(100).default(''),
  provinceCode: z.string().trim().min(2).max(3).default('on'),
  leads: z.array(leadSchema).max(10000),
});

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function masterBelongsToRequester(
  row: { assigned_user_id?: string | null; assigned_salesperson_id?: string | null },
  userId: string,
  salespersonId?: string | null
): boolean {
  return row.assigned_user_id === userId || Boolean(salespersonId && row.assigned_salesperson_id === salespersonId);
}

function masterIsUnassigned(row: { assigned_user_id?: string | null; assigned_salesperson_id?: string | null }): boolean {
  return !row.assigned_user_id && !row.assigned_salesperson_id;
}

function formatListDate(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date());
}

function buildListName(city: string, provinceCode: string): string {
  const location = [cleanText(city), cleanText(provinceCode).toUpperCase()].filter(Boolean).join(', ');
  return `${location || 'REALTOR.ca'} agents - ${formatListDate()}`.slice(0, 120);
}

function phoneKey(value: string | null | undefined): string {
  return normalizePhoneNumber(value, 'CA').e164 || String(value ?? '').replace(/\D/g, '');
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

async function resolveWorkspaceIdForImport(params: {
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

async function saveBrowserCaptureLeads(params: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  salespersonId?: string | null;
  workspaceId: string | null;
  listName?: string;
  city: string;
  provinceCode: string;
  leads: z.infer<typeof leadSchema>[];
}): Promise<SavedBrowserCaptureList | null> {
  if (!params.workspaceId || params.leads.length === 0) return null;

  const workspaceId = params.workspaceId;
  const listName = cleanText(params.listName).slice(0, 120) || buildListName(params.city, params.provinceCode);
  let warning: string | null = null;

  const uniqueLeads = new Map<string, z.infer<typeof leadSchema>>();
  for (const lead of params.leads) {
    const key = phoneKey(lead.phone);
    if (key && !uniqueLeads.has(key)) uniqueLeads.set(key, lead);
  }

  const { data: existingContacts, error: existingContactsError } = await params.admin
    .from('contacts')
    .select('id, user_id, phone, phone_e164')
    .eq('workspace_id', workspaceId);

  if (existingContactsError) {
    console.warn('[salesperson/realtor-ca-browser] contact lookup failed', existingContactsError);
  }

  const contactIdByPhone = new Map<string, string>();
  const currentUserContactIds = new Set<string>();
  for (const contact of existingContacts ?? []) {
    const id = String((contact as { id?: unknown }).id ?? '').trim();
    if (!id || (contact as { user_id?: unknown }).user_id !== params.userId) continue;

    currentUserContactIds.add(id);
    const key = String((contact as { phone_e164?: unknown }).phone_e164 ?? '').trim()
      || phoneKey(String((contact as { phone?: unknown }).phone ?? ''));
    if (key && id) contactIdByPhone.set(key, id);
  }

  const leadsToImport: z.infer<typeof leadSchema>[] = [];
  const leadsNeedingContact = new Map<string, z.infer<typeof leadSchema>>();
  const leadsForDialer = new Map<string, z.infer<typeof leadSchema>>();
  const contactIds = new Set<string>();
  const contactIdByLeadPhone = new Map<string, string>();
  const masterIdByPhone = new Map<string, string>();
  const masterMetadataById = new Map<string, Record<string, unknown>>();
  const masterIds = new Set<string>();
  let masterSkippedCount = 0;
  let masterAddedCount = 0;

  for (const lead of uniqueLeads.values()) {
    const key = phoneKey(lead.phone);
    const existingMaster = await findSalespersonLeadMaster(params.admin, {
      workspaceId,
      name: cleanText(lead.name),
      phone: lead.phone,
      email: lead.email ?? null,
      address: lead.formattedAddress ?? null,
      source: 'realtor_ca_browser_capture',
      externalId: lead.sourceUrl || lead.placeId || null,
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
      const belongsToRequester = masterBelongsToRequester(existingMaster.row, params.userId, params.salespersonId);
      const canClaimMaster = !belongsToRequester && masterIsUnassigned(existingMaster.row);
      if (belongsToRequester || canClaimMaster) {
        if (canClaimMaster) {
          const { error: claimError } = await params.admin
            .from('salesperson_lead_master')
            .update({
              assigned_user_id: params.userId,
              assigned_salesperson_id: params.salespersonId ?? null,
            })
            .eq('id', existingMaster.row.id);

          if (claimError) {
            console.warn('[salesperson/realtor-ca-browser] failed to claim unassigned master lead', claimError);
            warning = warning ?? 'Some existing leads could not be assigned to your sales account.';
            continue;
          }
        }

        masterIds.add(existingMaster.row.id);
        masterIdByPhone.set(key, existingMaster.row.id);
        masterMetadataById.set(existingMaster.row.id, {
          ...(existingMaster.row.metadata ?? {}),
          listName,
        });
        leadsForDialer.set(key, lead);

        const existingOwnContactId =
          (existingMaster.row.contact_id && currentUserContactIds.has(existingMaster.row.contact_id)
            ? existingMaster.row.contact_id
            : null) ?? contactIdByPhone.get(key);

        if (existingOwnContactId) {
          contactIds.add(existingOwnContactId);
          contactIdByLeadPhone.set(key, existingOwnContactId);
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
    const key = phoneKey(lead.phone);
    const existingContactId = contactIdByPhone.get(key);
    if (existingContactId) {
      contactIds.add(existingContactId);
      contactIdByLeadPhone.set(key, existingContactId);
      return [];
    }

    const normalized = normalizePhoneNumber(lead.phone, 'CA');
    return [{
      user_id: params.userId,
      workspace_id: workspaceId,
      full_name: cleanText(lead.name),
      phone: lead.phone,
      phone_e164: normalized.e164 || null,
      phone_country_code: normalized.countryCode || null,
      phone_area_code: normalized.areaCode || null,
      phone_area_label: normalized.areaLabel || null,
      phone_last_validated_at: new Date().toISOString(),
      phone_validation_error: normalized.error || null,
      email: cleanText(lead.email) || null,
      address: cleanText(lead.formattedAddress),
      status: 'new',
      source: 'REALTOR.ca browser scraper',
      tags: 'scraper, realtor.ca',
      notes: [
        lead.agencyBusinessName || lead.office ? `Agency: ${cleanText(lead.agencyBusinessName || lead.office)}` : '',
        lead.role ? `Role: ${cleanText(lead.role)}` : '',
        lead.sourceUrl ? `Source: ${cleanText(lead.sourceUrl)}` : '',
      ].filter(Boolean).join('\n') || null,
    }];
  });

  if (contactsToInsert.length > 0) {
    try {
      const insertedIds = await insertContactsWithFallback(params.admin, contactsToInsert);
      insertedIds.forEach((id) => contactIds.add(id));
      insertedIds.forEach((id, index) => {
        const lead = contactsToInsert[index];
        if (!lead) return;
        const key = phoneKey(lead.phone);
        if (key) contactIdByLeadPhone.set(key, id);
      });
    } catch (insertError) {
      console.warn('[salesperson/realtor-ca-browser] contact insert failed', insertError);
      warning = 'Added master leads where possible, but could not save all contact rows.';
    }
  }

  for (const lead of leadsToImport) {
    const normalized = normalizePhoneNumber(lead.phone, 'CA');
    const key = phoneKey(lead.phone);
    const master = await ensureSalespersonLeadMaster(params.admin, {
      workspaceId,
      assignedUserId: params.userId,
      assignedSalespersonId: params.salespersonId,
      createdByUserId: params.userId,
      contactId: contactIdByLeadPhone.get(key) ?? null,
      name: cleanText(lead.name),
      company: cleanText(lead.agencyBusinessName || lead.office) || null,
      phone: normalized.e164 || lead.phone,
      email: cleanText(lead.email) || null,
      website: cleanText(lead.website) || null,
      websiteDomain: cleanText(lead.websiteDomain) || null,
      address: cleanText(lead.formattedAddress),
      city: cleanText(lead.city || params.city),
      region: cleanText(lead.state || params.provinceCode.toUpperCase()),
      countryCode: 'CA',
      source: 'realtor_ca_browser_capture',
      externalId: cleanText(lead.sourceUrl || lead.placeId) || null,
      state: 'assigned',
      notes: lead.sourceUrl ? `Source: ${cleanText(lead.sourceUrl)}` : null,
      metadata: {
        listName,
        role: cleanText(lead.role) || null,
        office: cleanText(lead.office || lead.agencyBusinessName) || null,
        classification: cleanText(lead.classification) || 'individual_agent',
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
      masterIds.add(master.row.id);
      masterIdByPhone.set(key, master.row.id);
      masterMetadataById.set(master.row.id, {
        ...(master.row.metadata ?? {}),
        listName,
      });
    }
  }

  let listId: string | null = null;
  if (contactIds.size > 0 || masterIds.size > 0) {
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
          masterLeadIds: Array.from(masterIds),
        },
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[salesperson/realtor-ca-browser] smart list insert failed', error);
      warning = warning ?? `Saved leads, but could not create the "${listName}" list.`;
    } else {
      listId = String((createdList as { id?: unknown })?.id ?? '').trim() || null;
    }
  }

  if (masterMetadataById.size > 0) {
    await Promise.all(
      Array.from(masterMetadataById.entries()).map(async ([masterId, metadata]) => {
        const { error } = await params.admin
          .from('salesperson_lead_master')
          .update({
            metadata: {
              ...metadata,
              listId,
              listName,
              list_id: listId,
              list_name: listName,
            },
          })
          .eq('id', masterId);

        if (error) {
          console.warn('[salesperson/realtor-ca-browser] failed to attach lead list metadata', error);
        }
      })
    );
  }

  const { data: existingDialerRows, error: existingDialerError } = await params.admin
    .from('dialler_leads')
    .select('id, phone')
    .eq('workspace_id', workspaceId)
    .eq('user_id', params.userId);

  let dialerImportedCount = 0;
  let dialerSkippedCount = 0;
  const dialerLeadIds: string[] = [];

  if (existingDialerError) {
    console.warn('[salesperson/realtor-ca-browser] dialer lookup failed', existingDialerError);
    warning = warning ?? 'Saved the list, but could not check existing dialer leads.';
  } else {
    const existingDialerIdByPhone = new Map(
      (existingDialerRows ?? [])
        .map((row) => [
          phoneKey(String((row as { phone?: unknown }).phone ?? '')),
          String((row as { id?: unknown }).id ?? '').trim(),
        ] as const)
        .filter(([phone, id]) => Boolean(phone && id))
    );
    const seenDialerPhones = new Set(existingDialerIdByPhone.keys());
    const dialerInserts = Array.from(leadsForDialer.values()).flatMap((lead) => {
      const normalized = normalizePhoneNumber(lead.phone, 'CA');
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
        name: cleanText(lead.name),
        phone: normalized.e164 || lead.phone,
        phone_e164: normalized.e164 || null,
        phone_country_code: normalized.countryCode || null,
        phone_area_code: normalized.areaCode || null,
        phone_area_label: normalized.areaLabel || null,
        company: cleanText(lead.agencyBusinessName || lead.office) || null,
        email: cleanText(lead.email) || null,
        disposition: null,
        notes: [
          `List: ${listName}`,
          lead.role ? `Role: ${cleanText(lead.role)}` : '',
          lead.sourceUrl ? `Source: ${cleanText(lead.sourceUrl)}` : '',
        ].filter(Boolean).join('\n'),
        called_at: null,
        master_lead_id: masterIdByPhone.get(phoneKey(lead.phone)) ?? null,
      }];
    });

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
        .from('dialler_leads')
        .insert(insertPayload)
        .select('id, phone');

      if (error) {
        console.warn('[salesperson/realtor-ca-browser] dialer insert failed', error);
        warning = warning ?? 'Saved the list, but could not add leads to the dialer queue.';
      } else {
        dialerImportedCount = insertedDialerRows?.length ?? dialerInserts.length;
        for (const row of insertedDialerRows ?? []) {
          const id = String((row as { id?: unknown }).id ?? '').trim();
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
      { error: firstIssue?.message ?? 'Invalid REALTOR.ca browser capture.' },
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
        { error: 'Salesperson access is required for REALTOR.ca browser capture import.' },
        { status: 403 }
      );
    }

    const workspaceId = await resolveWorkspaceIdForImport({
      admin,
      requestUser,
      salesperson,
      requestedWorkspaceId: parsed.data.workspaceId,
    });

    const savedList = await saveBrowserCaptureLeads({
      admin,
      userId: requestUser.id,
      salespersonId: salesperson?.id ?? null,
      workspaceId,
      listName: parsed.data.listName,
      city: parsed.data.city,
      provinceCode: parsed.data.provinceCode,
      leads: parsed.data.leads,
    });

    return NextResponse.json({
      ok: true,
      savedList,
    });
  } catch (error) {
    console.error('[api/salesperson/realtor-ca-browser] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'REALTOR.ca browser capture import failed.' },
      { status: 500 }
    );
  }
}
