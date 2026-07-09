import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { normalizePhoneMarket, normalizePhoneNumber, type SupportedPhoneMarket } from '@/lib/dialer/phone';
import { findClaimedPhonesInWorkspace } from '@/lib/sales-leads/master-list';
import type { SalesLeadState } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPTIONAL_SALES_LEAD_COLUMNS = [
  'source',
  'phone_e164',
  'phone_country_code',
  'phone_area_code',
  'phone_area_label',
  'next_follow_up_at',
  'metadata',
  'list_name',
] as const;

type CsvRow = Record<string, string | null | undefined>;

type ImportableSalesLead = {
  workspace_id: string;
  assigned_user_id: string;
  created_by_user_id: string;
  name: string;
  phone?: string;
  phone_e164?: string | null;
  phone_country_code?: string | null;
  phone_area_code?: string | null;
  phone_area_label?: string | null;
  email?: string;
  email_normalized?: string | null;
  address?: string | null;
  lead_state: SalesLeadState;
  source?: string;
  notes?: string;
  next_follow_up_at?: string;
  list_name?: string | null;
  metadata?: Record<string, unknown>;
};

function mergeTags(rowTags: string, defaultTags: string): string {
  const values = [...rowTags.split(','), ...defaultTags.split(',')]
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (values.length === 0) return '';

  const deduped = new Map<string, string>();
  values.forEach((tag) => {
    const key = tag.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, tag);
    }
  });

  return Array.from(deduped.values()).join(', ');
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getValue(row: CsvRow, aliases: string[]): string {
  for (const alias of aliases) {
    const matchedKey = Object.keys(row).find((key) => normalizeHeader(key) === alias);
    if (!matchedKey) continue;
    const value = row[matchedKey];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeStatus(value: string): SalesLeadState {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'new') return 'new';
  if (normalized === 'hot' || ['interested', 'appointment', 'talked', 'converted'].includes(normalized)) return 'interested';
  if (['follow_up', 'follow-up', 'follow up', 'contacted', 'callback', 'left_voicemail', 'left voicemail'].includes(normalized)) {
    return 'callback';
  }
  if (['not_interested', 'not interested', 'bad_number', 'bad number', 'dnc', 'do_not_call', 'do not call'].includes(normalized)) {
    return normalized.includes('dnc') || normalized.includes('do_not_call') || normalized.includes('do not call') ? 'dnc' : 'not_now';
  }
  if (normalized === 'warm') return 'callback';
  if (normalized === 'cold') return 'not_now';
  return 'assigned';
}

function toIsoOrUndefined(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function leadSignature(lead: Pick<ImportableSalesLead, 'name' | 'phone' | 'phone_e164' | 'email' | 'address'>): string {
  return [
    lead.name.trim().toLowerCase(),
    (lead.phone_e164 ?? lead.phone ?? '').trim(),
    (lead.email ?? '').trim().toLowerCase(),
    (lead.address ?? '').trim().toLowerCase(),
  ].join('|');
}

function isMissingSalesLeadColumn(error: unknown, column: string): boolean {
  if (!error || typeof error !== 'object' || !('message' in error)) return false;
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return (
    message.includes(`column sales_leads.${column}`) ||
    message.includes(`column "${column}"`) ||
    message.includes(`${column} does not exist`) ||
    message.includes(`could not find the '${column}' column`)
  );
}

async function insertSalesLeadsWithFallback(
  admin: ReturnType<typeof createAdminClient>,
  rows: ImportableSalesLead[]
) {
  let payload = rows.map((row) => ({ ...row }));

  while (true) {
    const { data, error } = await admin.from('sales_leads').insert(payload).select('id');
    if (!error) {
      return (data ?? [])
        .map((row) => String((row as { id?: unknown }).id ?? '').trim())
        .filter(Boolean);
    }

    const missingColumn = OPTIONAL_SALES_LEAD_COLUMNS.find((column) => isMissingSalesLeadColumn(error, column));
    if (!missingColumn) {
      throw error;
    }

    payload = payload.map((row) => {
      const nextRow = { ...row } as Partial<ImportableSalesLead>;
      delete nextRow[missingColumn];
      return nextRow as ImportableSalesLead;
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Request must be multipart/form-data. Do not set Content-Type manually when sending FormData.' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const requestedWorkspaceId = String(formData.get('workspaceId') ?? '').trim() || null;
    const listName = String(formData.get('listName') ?? '').trim();
    const phoneMarket = normalizePhoneMarket(String(formData.get('phoneMarket') ?? ''));

    if (!(file instanceof File) || !file.size) {
      return NextResponse.json({ error: 'Choose a CSV file to import.' }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      return NextResponse.json({ error: 'Only CSV files are supported right now.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const workspaceResolution = await resolveWorkspaceIdForUser(
      admin as unknown as MinimalSupabaseClient,
      requestUser.id,
      requestedWorkspaceId
    );

    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }

    const csvText = await file.text();
    const parsedRows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as CsvRow[];

    if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
      return NextResponse.json({ error: 'The CSV file is empty.' }, { status: 400 });
    }

    const { data: existingSalesLeads, error: existingSalesLeadsError } = await admin
      .from('sales_leads')
      .select('id, name, phone, phone_e164, email, address')
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('assigned_user_id', requestUser.id);

    if (existingSalesLeadsError) {
      throw existingSalesLeadsError;
    }

    const existingSalesLeadIdBySignature = new Map<string, string>();
    const seenSignatures = new Set<string>();

    (existingSalesLeads ?? []).forEach((lead) => {
      const signature = leadSignature({
        name: String(lead.name ?? ''),
        phone: lead.phone ?? undefined,
        phone_e164: lead.phone_e164 ?? null,
        email: lead.email ?? undefined,
        address: String(lead.address ?? ''),
      });
      seenSignatures.add(signature);
      if (lead.id) {
        existingSalesLeadIdBySignature.set(signature, String(lead.id));
      }
    });

    const salesLeadsToInsert: ImportableSalesLead[] = [];
    const skippedRows: string[] = [];
    const matchedListSalesLeadIds = new Set<string>();

    parsedRows.forEach((row, index) => {
      const fullName = getValue(row, ['full_name', 'fullname', 'name', 'contact_name', 'lead_name']);
      const firstName = getValue(row, ['first_name', 'firstname', 'first', 'given_name']);
      const lastName = getValue(row, ['last_name', 'lastname', 'last', 'surname', 'family_name']);
      const phone = getValue(row, ['phone', 'phone_number', 'mobile', 'mobile_phone', 'cell', 'telephone']);
      const email = getValue(row, ['email', 'email_address']);
      const address = getValue(row, ['address', 'street_address', 'street', 'property_address', 'address_line', 'address_1']);
      const campaignId = getValue(row, ['campaign_id', 'campaignid']);
      const farmId = getValue(row, ['farm_id', 'farmid']);
      const notes = getValue(row, ['notes', 'note', 'comments', 'comment', 'description']);
      const source = getValue(row, ['source', 'lead_source', 'origin', 'channel']);
      const tags = mergeTags(getValue(row, ['tags', 'tag', 'labels']), '');
      const status = normalizeStatus(getValue(row, ['status', 'lead_status', 'interest_level', 'temperature']));
      const followUpAt = toIsoOrUndefined(
        getValue(row, ['follow_up_at', 'follow_up', 'followup', 'reminder_date', 'next_contact'])
      );

      const resolvedName =
        fullName ||
        [firstName, lastName].filter(Boolean).join(' ').trim() ||
        address ||
        'Lead';

      const hasUsableData = [resolvedName, phone, email, address, notes, source, tags].some(Boolean);
      if (!hasUsableData) {
        skippedRows.push(`Row ${index + 2}: empty row`);
        return;
      }

      const normalizedPhone = phone ? normalizePhoneNumber(phone, phoneMarket as SupportedPhoneMarket) : null;
      const nextLead: ImportableSalesLead = {
        workspace_id: workspaceResolution.workspaceId!,
        assigned_user_id: requestUser.id,
        created_by_user_id: requestUser.id,
        name: resolvedName,
        phone: phone || undefined,
        phone_e164: normalizedPhone?.e164 ?? null,
        phone_country_code: normalizedPhone?.countryCode ?? null,
        phone_area_code: normalizedPhone?.areaCode ?? null,
        phone_area_label: normalizedPhone?.areaLabel ?? null,
        email: email || undefined,
        email_normalized: email ? email.toLowerCase() : null,
        address: address || null,
        lead_state: status,
        source: source || undefined,
        notes: notes || undefined,
        next_follow_up_at: followUpAt,
        list_name: listName || null,
        metadata: {
          importSource: 'csv',
          tags: tags || null,
          campaignId: campaignId || null,
          farmId: farmId || null,
          phoneValidationError: normalizedPhone?.error ?? null,
        },
      };

      const signature = leadSignature(nextLead);
      if (seenSignatures.has(signature)) {
        const existingId = existingSalesLeadIdBySignature.get(signature);
        if (existingId) {
          matchedListSalesLeadIds.add(existingId);
        }
        skippedRows.push(`Row ${index + 2}: duplicate lead skipped`);
        return;
      }

      seenSignatures.add(signature);
      salesLeadsToInsert.push(nextLead);
    });

    // Cross-rep collision check: drop any sales lead whose phone is already claimed
    // by a different rep in this workspace.
    const phonesToCheck = salesLeadsToInsert
      .map((c) => c.phone_e164)
      .filter((p): p is string => Boolean(p));

    const claimedPhones = await findClaimedPhonesInWorkspace(
      admin,
      workspaceResolution.workspaceId!,
      requestUser.id,
      phonesToCheck,
    );

    let claimedByOtherRepCount = 0;
    const finalSalesLeadsToInsert = salesLeadsToInsert.filter((c) => {
      if (c.phone_e164 && claimedPhones.has(c.phone_e164)) {
        claimedByOtherRepCount += 1;
        return false;
      }
      return true;
    });

    if (finalSalesLeadsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        skipped: skippedRows.length,
        claimedByOtherRep: claimedByOtherRepCount,
        message:
          claimedByOtherRepCount > 0
            ? `No leads imported — all ${claimedByOtherRepCount} lead${claimedByOtherRepCount === 1 ? ' is' : 's are'} already assigned to another rep.`
            : listName && matchedListSalesLeadIds.size > 0
              ? `No new leads were imported. Matched ${matchedListSalesLeadIds.size} existing lead${matchedListSalesLeadIds.size === 1 ? '' : 's'} for the "${listName}" list.`
              : 'No new leads were imported.',
        skippedRows: skippedRows.slice(0, 20),
        createdListId: null,
        createdListName: null,
        requestedListName: listName || null,
        importedSalesLeadIds: listName ? Array.from(matchedListSalesLeadIds) : [],
      });
    }

    const chunkSize = 200;
    const importedSalesLeadIds: string[] = [];

    for (let start = 0; start < finalSalesLeadsToInsert.length; start += chunkSize) {
      const chunk = finalSalesLeadsToInsert.slice(start, start + chunkSize);
      const insertedIds = await insertSalesLeadsWithFallback(admin, chunk);
      importedSalesLeadIds.push(...insertedIds);
      insertedIds.forEach((id) => matchedListSalesLeadIds.add(id));
    }

    const importedCount = finalSalesLeadsToInsert.length;
    const claimedNote = claimedByOtherRepCount > 0
      ? ` ${claimedByOtherRepCount} lead${claimedByOtherRepCount === 1 ? ' was' : 's were'} skipped — already assigned to another rep.`
      : '';

    return NextResponse.json({
      success: true,
      imported: importedCount,
      skipped: skippedRows.length,
      claimedByOtherRep: claimedByOtherRepCount,
      message:
        `Imported ${importedCount} lead${importedCount === 1 ? '' : 's'}.` +
        (listName ? ` Tagged them with the "${listName}" sales list.` : '') +
        claimedNote,
      skippedRows: skippedRows.slice(0, 20),
      createdListId: null,
      createdListName: listName || null,
      requestedListName: listName || null,
      importedSalesLeadIds: listName ? Array.from(matchedListSalesLeadIds) : importedSalesLeadIds,
      importedContactIds: [],
    });
  } catch (error) {
    console.error('[leads/import] import failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import CSV' },
      { status: 500 }
    );
  }
}
