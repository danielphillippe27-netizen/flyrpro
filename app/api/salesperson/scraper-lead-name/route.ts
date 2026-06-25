import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { normalizePhoneMarket, normalizePhoneNumber } from '@/lib/dialer/phone';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  workspace_id: string | null;
};

const requestSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(180),
  phone: z.string().trim().max(40).optional().nullable(),
  sourceUrl: z.string().trim().max(1000).optional().nullable(),
  placeId: z.string().trim().max(300).optional().nullable(),
  countryCode: z.string().trim().min(2).max(2).default('CA'),
});

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
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

async function resolveWorkspaceIdForEdit(params: {
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

async function updateByPhone(params: {
  admin: ReturnType<typeof createAdminClient>;
  table: 'contacts' | 'dialler_leads';
  column: 'full_name' | 'name';
  workspaceId: string;
  userId: string;
  name: string;
  phone: string;
  phoneE164: string | null;
}): Promise<number> {
  const matchedIds = new Set<string>();
  const selectAndUpdate = async (phoneColumn: 'phone' | 'phone_e164', value: string | null) => {
    if (!value) return;
    const { data, error } = await params.admin
      .from(params.table)
      .update({ [params.column]: params.name, updated_at: new Date().toISOString() })
      .eq('workspace_id', params.workspaceId)
      .eq('user_id', params.userId)
      .eq(phoneColumn, value)
      .select('id');

    if (error) throw error;
    for (const row of data ?? []) {
      const id = cleanText((row as { id?: unknown }).id);
      if (id) matchedIds.add(id);
    }
  };

  await selectAndUpdate('phone_e164', params.phoneE164);
  await selectAndUpdate('phone', params.phone);
  return matchedIds.size;
}

async function findMasterIds(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  userId: string;
  salespersonId?: string | null;
  phone: string | null;
  phoneE164: string | null;
  externalIds: string[];
}): Promise<string[]> {
  const ids = new Set<string>();
  const collect = async (column: 'phone' | 'phone_e164' | 'external_id', value: string | null) => {
    if (!value) return;
    let query = params.admin
      .from('salesperson_lead_master')
      .select('id')
      .eq('workspace_id', params.workspaceId)
      .eq(column, value);

    query = params.salespersonId
      ? query.or(`assigned_user_id.eq.${params.userId},assigned_salesperson_id.eq.${params.salespersonId}`)
      : query.eq('assigned_user_id', params.userId);

    const { data, error } = await query.limit(20);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = cleanText((row as { id?: unknown }).id);
      if (id) ids.add(id);
    }
  };

  await collect('phone_e164', params.phoneE164);
  await collect('phone', params.phone);
  for (const externalId of params.externalIds) {
    await collect('external_id', externalId);
  }

  return Array.from(ids);
}

export async function PATCH(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { error: firstIssue?.message ?? 'Invalid lead name update.' },
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
        { error: 'Salesperson access is required to edit scraper leads.' },
        { status: 403 }
      );
    }

    const workspaceId = await resolveWorkspaceIdForEdit({
      admin,
      requestUser,
      salesperson,
      requestedWorkspaceId: parsed.data.workspaceId,
    });

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
    }

    const phone = cleanText(parsed.data.phone);
    const normalizedPhone = normalizePhoneNumber(phone, normalizePhoneMarket(parsed.data.countryCode));
    const externalIds = Array.from(
      new Set([parsed.data.sourceUrl, parsed.data.placeId].map(cleanText).filter(Boolean))
    );

    if (!phone && externalIds.length === 0) {
      return NextResponse.json({ error: 'A phone or source URL is required to edit this lead.' }, { status: 400 });
    }

    const [contactCount, dialerCount, masterIds] = await Promise.all([
      phone
        ? updateByPhone({
            admin,
            table: 'contacts',
            column: 'full_name',
            workspaceId,
            userId: requestUser.id,
            name: parsed.data.name,
            phone,
            phoneE164: normalizedPhone.e164 || null,
          })
        : 0,
      phone
        ? updateByPhone({
            admin,
            table: 'dialler_leads',
            column: 'name',
            workspaceId,
            userId: requestUser.id,
            name: parsed.data.name,
            phone,
            phoneE164: normalizedPhone.e164 || null,
          })
        : 0,
      findMasterIds({
        admin,
        workspaceId,
        userId: requestUser.id,
        salespersonId: salesperson?.id ?? null,
        phone: phone || null,
        phoneE164: normalizedPhone.e164 || null,
        externalIds,
      }),
    ]);

    let masterCount = 0;
    if (masterIds.length > 0) {
      const { data, error } = await admin
        .from('salesperson_lead_master')
        .update({ name: parsed.data.name })
        .in('id', masterIds)
        .select('id');

      if (error) throw error;
      masterCount = data?.length ?? masterIds.length;
    }

    return NextResponse.json({
      ok: true,
      name: parsed.data.name,
      updated: {
        contacts: contactCount,
        dialerLeads: dialerCount,
        masterLeads: masterCount,
      },
    });
  } catch (error) {
    console.error('[api/salesperson/scraper-lead-name] PATCH error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update scraper lead name.' },
      { status: 500 }
    );
  }
}
