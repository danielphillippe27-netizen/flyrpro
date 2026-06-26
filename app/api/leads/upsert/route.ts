import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { pushLeadToConnectedCrms, type CrmPushResult } from '@/lib/integrations/auto-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isMissingColumn(error: unknown, column: string) {
  if (!error || typeof error !== 'object') return false;
  const text = `${(error as { message?: string }).message ?? ''} ${(error as { details?: string | null }).details ?? ''}`.toLowerCase();
  return text.includes(column.toLowerCase()) && (text.includes('does not exist') || text.includes('not find') || text.includes('column'));
}

function cleanedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(cleanedString).filter(Boolean) as string[]));
}

function removeMissingColumn(payload: Record<string, unknown>, error: unknown): boolean {
  for (const column of Object.keys(payload)) {
    if (isMissingColumn(error, column)) {
      delete payload[column];
      return true;
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const campaignId = typeof body.campaignId === 'string' && body.campaignId.trim() ? body.campaignId.trim() : null;
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const outcome = typeof body.outcome === 'string' && body.outcome.trim() ? body.outcome.trim() : 'new';
  const email = cleanedString(body.email);
  const phone = cleanedString(body.phone);
  const notes = cleanedString(body.notes);
  const followUpNote = cleanedString(body.followUpNote);
  const appointmentNote = cleanedString(body.appointmentNote);
  const address = cleanedString(body.address);
  const addressIds = cleanedStringList(body.addressIds);
  const buildingId = cleanedString(body.buildingId);
  const sessionId = cleanedString(body.sessionId);
  const requestedWorkspaceId = typeof body.workspaceId === 'string' && body.workspaceId.trim()
    ? body.workspaceId.trim()
    : null;
  if (!fullName) {
    return NextResponse.json({ error: 'fullName is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const workspace = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId
  );
  const payload: Record<string, unknown> = {
    user_id: requestUser.id,
    workspace_id: workspace.workspaceId,
    full_name: fullName,
    status: outcome,
    source: 'android',
  };
  if (campaignId) payload.campaign_id = campaignId;
  if (email) payload.email = email;
  if (phone) payload.phone = phone;
  if (notes) payload.notes = notes;
  if (address) payload.address = address;
  if (addressIds[0]) payload.campaign_address_id = addressIds[0];
  if (buildingId) payload.building_id = buildingId;
  if (sessionId) payload.session_id = sessionId;

  let result = await admin
    .from('contacts')
    .insert(payload)
    .select('id, campaign_id, full_name, status')
    .single();
  let guard = 0;
  while (result.error && guard < 8 && removeMissingColumn(payload, result.error)) {
    guard += 1;
    result = await admin
      .from('contacts')
      .insert(payload)
      .select('id, campaign_id, full_name, status')
      .single();
  }
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const activityRows = [
    followUpNote ? { contact_id: result.data.id, type: 'note', note: followUpNote } : null,
    appointmentNote ? { contact_id: result.data.id, type: 'meeting', note: appointmentNote } : null,
  ].filter((row): row is { contact_id: string; type: string; note: string } => row !== null);
  if (activityRows.length > 0) {
    const { error: activityError } = await admin.from('contact_activities').insert(activityRows);
    if (activityError) {
      console.warn('[api/leads/upsert] contact activity insert failed', activityError);
    }
  }

  // Auto-push to connected CRMs immediately after save
  let crmSync: CrmPushResult[] = [];
  if (workspace.workspaceId) {
    try {
      crmSync = await pushLeadToConnectedCrms(admin, requestUser.id, workspace.workspaceId, {
        id: result.data.id,
        full_name: result.data.full_name ?? fullName,
        phone: cleanedString(body.phone),
        email: cleanedString(body.email),
        address: cleanedString(body.address),
        notes: cleanedString(body.notes),
        campaign_id: result.data.campaign_id ?? campaignId,
      });
    } catch (err) {
      console.warn('[api/leads/upsert] CRM auto-push failed', err);
    }
  }

  return NextResponse.json({
    id: result.data.id,
    campaignId: result.data.campaign_id ?? campaignId,
    fullName: result.data.full_name ?? fullName,
    outcome: result.data.status ?? outcome,
    crmSync,
  }, { status: 201 });
}
