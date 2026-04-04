import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getBoldTrailTokenForWorkspace } from '../_lib/auth';
import {
  BoldTrailAPIClient,
  BoldTrailAPIError,
  type BoldTrailLeadPayload,
} from '../_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PushLeadBody = BoldTrailLeadPayload & {
  campaignId?: string | null;
  campaign_id?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
};

const boldTrailClient = new BoldTrailAPIClient();

function cleaned(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLead(body: PushLeadBody): PushLeadBody {
  return {
    id: cleaned(body.id),
    name: cleaned(body.name),
    phone: cleaned(body.phone),
    email: cleaned(body.email),
    address: cleaned(body.address),
    source: cleaned(body.source) || 'FLYR',
    notes: cleaned(body.notes),
    campaignId: cleaned(body.campaignId) ?? cleaned(body.campaign_id),
    createdAt: cleaned(body.createdAt) ?? cleaned(body.created_at),
  };
}

async function resolveTargetWorkspaceId(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  campaignId?: string
): Promise<{ workspaceId: string | null; error?: string; status?: number }> {
  let requestedWorkspaceId: string | null = null;

  if (campaignId) {
    const { data: campaignRow } = await supabase
      .from('campaigns')
      .select('workspace_id')
      .eq('id', campaignId)
      .maybeSingle();
    requestedWorkspaceId = campaignRow?.workspace_id ?? null;
  }

  return resolveWorkspaceIdForUser(
    supabase as unknown as MinimalSupabaseClient,
    userId,
    requestedWorkspaceId
  );
}

async function findExistingBoldTrailContactId(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('crm_object_links')
    .select('remote_object_id')
    .eq('user_id', userId)
    .eq('crm_type', 'boldtrail')
    .eq('flyr_lead_id', leadId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.remote_object_id ? String(data.remote_object_id) : null;
}

async function upsertBoldTrailLink(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string,
  contactId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from('crm_object_links')
    .select('id')
    .eq('user_id', userId)
    .eq('crm_type', 'boldtrail')
    .eq('flyr_lead_id', leadId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const payload = {
    remote_object_id: contactId,
    remote_object_type: 'contact',
    remote_metadata: {
      provider: 'boldtrail',
    },
    fub_person_id: null,
  };

  if (existing?.id) {
    const { error } = await supabase
      .from('crm_object_links')
      .update(payload)
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('crm_object_links')
    .insert({
      user_id: userId,
      crm_type: 'boldtrail',
      flyr_lead_id: leadId,
      ...payload,
    });
  if (error) throw error;
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as PushLeadBody | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const lead = normalizeLead(body);
    if (!lead.id) {
      return NextResponse.json({ success: false, error: 'Lead ID is required' }, { status: 400 });
    }
    if (!lead.email && !lead.phone) {
      return NextResponse.json(
        { success: false, error: 'Lead must have at least one of email or phone for BoldTrail sync.' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const workspaceResolution = await resolveTargetWorkspaceId(
      supabase,
      requestUser.id,
      lead.campaignId ?? undefined
    );

    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { success: false, error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }

    const accessToken = await getBoldTrailTokenForWorkspace(supabase, workspaceResolution.workspaceId);
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'BoldTrail is not connected' },
        { status: 404 }
      );
    }

    const existingContactId = await findExistingBoldTrailContactId(supabase, requestUser.id, lead.id);
    const result = existingContactId
      ? await boldTrailClient.updateContact(accessToken, existingContactId, lead)
      : await boldTrailClient.createContact(accessToken, lead);

    if (lead.notes?.trim()) {
      try {
        await boldTrailClient.addNote(accessToken, result.contactId, lead.notes);
      } catch (error) {
        console.warn('[boldtrail/push-lead] note creation failed', {
          leadId: lead.id,
          remoteContactId: result.contactId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    await upsertBoldTrailLink(supabase, requestUser.id, lead.id, result.contactId);
    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'boldtrail');

    return NextResponse.json({
      success: true,
      message: 'Lead synced to BoldTrail',
      remoteContactId: result.contactId,
      action: result.action,
    });
  } catch (error) {
    console.error('[boldtrail/push-lead]', error);

    const status =
      error instanceof BoldTrailAPIError && error.kind === 'invalid_token'
        ? 401
        : error instanceof BoldTrailAPIError && error.kind === 'network'
          ? 502
          : 500;

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'BoldTrail sync failed',
      },
      { status }
    );
  }
}
