import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { normalizePhoneMarket, normalizePhoneNumber, type SupportedPhoneMarket } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPTIONAL_CONTACT_COLUMNS = [
  'source',
  'tags',
  'last_contacted',
  'follow_up_at',
  'appointment_at',
  'phone_e164',
  'phone_country_code',
  'phone_area_code',
  'phone_area_label',
  'phone_last_validated_at',
  'phone_validation_error',
] as const;

type CsvRow = Record<string, string | null | undefined>;

type ImportableContact = {
  user_id: string;
  workspace_id: string;
  full_name: string;
  phone?: string;
  phone_e164?: string | null;
  phone_country_code?: string | null;
  phone_area_code?: string | null;
  phone_area_label?: string | null;
  phone_last_validated_at?: string;
  phone_validation_error?: string | null;
  email?: string;
  address: string;
  campaign_id?: string;
  farm_id?: string;
  status: 'hot' | 'warm' | 'cold' | 'new';
  source?: string;
  tags?: string;
  last_contacted?: string;
  notes?: string;
  follow_up_at?: string;
  appointment_at?: string;
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

function normalizeStatus(value: string): ImportableContact['status'] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'hot' || normalized === 'warm' || normalized === 'cold' || normalized === 'new') {
    return normalized;
  }
  if (['interested', 'appointment', 'talked', 'converted'].includes(normalized)) return 'hot';
  if (['follow_up', 'follow-up', 'follow up', 'contacted', 'callback', 'left_voicemail', 'left voicemail'].includes(normalized)) {
    return 'warm';
  }
  if (['not_interested', 'not interested', 'bad_number', 'bad number', 'dnc', 'do_not_call', 'do not call'].includes(normalized)) {
    return 'cold';
  }
  return 'new';
}

function toIsoOrUndefined(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function contactSignature(contact: Pick<ImportableContact, 'full_name' | 'phone' | 'phone_e164' | 'email' | 'address'>): string {
  return [
    contact.full_name.trim().toLowerCase(),
    (contact.phone_e164 ?? contact.phone ?? '').trim(),
    (contact.email ?? '').trim().toLowerCase(),
    contact.address.trim().toLowerCase(),
  ].join('|');
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
  rows: ImportableContact[]
) {
  let payload = rows.map((row) => ({ ...row }));

  while (true) {
    const { data, error } = await admin.from('contacts').insert(payload).select('id');
    if (!error) {
      return (data ?? [])
        .map((row) => String((row as { id?: unknown }).id ?? '').trim())
        .filter(Boolean);
    }

    const missingColumn = OPTIONAL_CONTACT_COLUMNS.find((column) => isMissingContactsColumn(error, column));
    if (!missingColumn) {
      throw error;
    }

    payload = payload.map((row) => {
      const nextRow = { ...row } as Partial<ImportableContact>;
      delete nextRow[missingColumn];
      return nextRow as ImportableContact;
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

    const { data: existingContacts, error: existingContactsError } = await admin
      .from('contacts')
      .select('id, full_name, phone, phone_e164, email, address')
      .eq('workspace_id', workspaceResolution.workspaceId);

    if (existingContactsError) {
      throw existingContactsError;
    }

    const existingContactIdBySignature = new Map<string, string>();
    const seenSignatures = new Set<string>();

    (existingContacts ?? []).forEach((contact) => {
      const signature = contactSignature({
        full_name: String(contact.full_name ?? ''),
        phone: contact.phone ?? undefined,
        phone_e164: contact.phone_e164 ?? null,
        email: contact.email ?? undefined,
        address: String(contact.address ?? ''),
      });
      seenSignatures.add(signature);
      if (contact.id) {
        existingContactIdBySignature.set(signature, String(contact.id));
      }
    });

    const contactsToInsert: ImportableContact[] = [];
    const skippedRows: string[] = [];
    const matchedListContactIds = new Set<string>();

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
      const lastContacted = toIsoOrUndefined(
        getValue(row, ['last_contacted', 'last_contacted_at', 'last_contact', 'last_touch'])
      );
      const followUpAt = toIsoOrUndefined(
        getValue(row, ['follow_up_at', 'follow_up', 'followup', 'reminder_date', 'next_contact'])
      );
      const appointmentAt = toIsoOrUndefined(
        getValue(row, ['appointment_at', 'appointment', 'meeting_at', 'meeting'])
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
      const nextContact: ImportableContact = {
        user_id: requestUser.id,
        workspace_id: workspaceResolution.workspaceId!,
        full_name: resolvedName,
        phone: phone || undefined,
        phone_e164: normalizedPhone?.e164 ?? null,
        phone_country_code: normalizedPhone?.countryCode ?? null,
        phone_area_code: normalizedPhone?.areaCode ?? null,
        phone_area_label: normalizedPhone?.areaLabel ?? null,
        phone_last_validated_at: phone ? new Date().toISOString() : undefined,
        phone_validation_error: normalizedPhone?.error ?? null,
        email: email || undefined,
        address: address || '',
        campaign_id: campaignId || undefined,
        farm_id: farmId || undefined,
        status,
        source: source || undefined,
        tags: tags || undefined,
        last_contacted: lastContacted,
        notes: notes || undefined,
        follow_up_at: followUpAt,
        appointment_at: appointmentAt,
      };

      const signature = contactSignature(nextContact);
      if (seenSignatures.has(signature)) {
        const existingId = existingContactIdBySignature.get(signature);
        if (existingId) {
          matchedListContactIds.add(existingId);
        }
        skippedRows.push(`Row ${index + 2}: duplicate lead skipped`);
        return;
      }

      seenSignatures.add(signature);
      contactsToInsert.push(nextContact);
    });

    if (contactsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        skipped: skippedRows.length,
        message:
          listName && matchedListContactIds.size > 0
            ? `No new leads were imported. Matched ${matchedListContactIds.size} existing lead${matchedListContactIds.size === 1 ? '' : 's'} for the "${listName}" list.`
            : 'No new leads were imported.',
        skippedRows: skippedRows.slice(0, 20),
        createdListId: null,
        createdListName: null,
        requestedListName: listName || null,
        importedContactIds: listName ? Array.from(matchedListContactIds) : [],
      });
    }

    const chunkSize = 200;
    const importedContactIds: string[] = [];
    for (let start = 0; start < contactsToInsert.length; start += chunkSize) {
      const chunk = contactsToInsert.slice(start, start + chunkSize);
      const insertedIds = await insertContactsWithFallback(admin, chunk);
      importedContactIds.push(...insertedIds);
      insertedIds.forEach((id) => matchedListContactIds.add(id));
    }

    let createdListId: string | null = null;
    let createdListWarning: string | null = null;

    if (listName && matchedListContactIds.size > 0) {
      try {
        const { data: createdList, error: smartListError } = await admin
          .from('smart_lists')
          .insert({
            workspace_id: workspaceResolution.workspaceId,
            created_by_user_id: requestUser.id,
            name: listName,
            criteria: {
              baseKind: 'custom',
              source: '',
              tags: [],
              campaignIds: [],
              farmIds: [],
              contactIds: Array.from(matchedListContactIds),
            },
          })
          .select('id')
          .single();

        if (smartListError) {
          throw smartListError;
        }

        createdListId = String((createdList as { id?: unknown })?.id ?? '').trim() || null;
      } catch (smartListError) {
        console.error('[leads/import] list creation failed', smartListError);
        createdListWarning = ` Imported leads were saved, but the "${listName}" list could not be created.`;
      }
    }

    return NextResponse.json({
      success: true,
      imported: contactsToInsert.length,
      skipped: skippedRows.length,
      message:
        `Imported ${contactsToInsert.length} lead${contactsToInsert.length === 1 ? '' : 's'}.` +
        (listName && createdListId ? ` Created the "${listName}" list.` : '') +
        (createdListWarning ?? ''),
      skippedRows: skippedRows.slice(0, 20),
      createdListId,
      createdListName: createdListId ? listName : null,
      requestedListName: listName || null,
      importedContactIds: listName ? Array.from(matchedListContactIds) : [],
    });
  } catch (error) {
    console.error('[leads/import] import failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import CSV' },
      { status: 500 }
    );
  }
}
