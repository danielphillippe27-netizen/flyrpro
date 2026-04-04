import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getHubSpotAuthForUserWorkspace } from '../_lib/auth';
import {
  HubSpotAPIClient,
  HubSpotAPIError,
  type HubSpotLeadPayload,
} from '../_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PushLeadBody = HubSpotLeadPayload & {
  campaignId?: string | null;
  campaign_id?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
};

const hubSpotClient = new HubSpotAPIClient();

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
    task:
      body.task && typeof body.task === 'object'
        ? {
            title: cleaned(body.task.title),
            due_date: cleaned(body.task.due_date),
          }
        : undefined,
    appointment:
      body.appointment && typeof body.appointment === 'object'
        ? {
            date: cleaned(body.appointment.date),
            title: cleaned(body.appointment.title),
            notes: cleaned(body.appointment.notes),
            location: cleaned(body.appointment.location),
          }
        : undefined,
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

async function findExistingHubSpotContactId(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('crm_object_links')
    .select('remote_object_id')
    .eq('user_id', userId)
    .eq('crm_type', 'hubspot')
    .eq('flyr_lead_id', leadId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.remote_object_id ? String(data.remote_object_id) : null;
}

async function upsertHubSpotLink(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string,
  contactId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from('crm_object_links')
    .select('id')
    .eq('user_id', userId)
    .eq('crm_type', 'hubspot')
    .eq('flyr_lead_id', leadId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const payload = {
    remote_object_id: contactId,
    remote_object_type: 'contact',
    remote_metadata: {
      provider: 'hubspot',
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
      crm_type: 'hubspot',
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

    const hubSpotAuth = await getHubSpotAuthForUserWorkspace(supabase, requestUser.id);
    if (!hubSpotAuth) {
      return NextResponse.json(
        { success: false, error: 'HubSpot is not connected' },
        { status: 404 }
      );
    }
    const accessToken = hubSpotAuth.headers.Authorization.replace('Bearer ', '');

    let existingContactId = await findExistingHubSpotContactId(supabase, requestUser.id, lead.id);
    if (!existingContactId && lead.email) {
      existingContactId = await hubSpotClient.findContactByEmail(accessToken, lead.email);
    }
    if (!existingContactId && lead.phone) {
      existingContactId = await hubSpotClient.findContactByPhone(accessToken, lead.phone);
    }

    const result = existingContactId
      ? await hubSpotClient.updateContact(accessToken, existingContactId, lead)
      : await hubSpotClient.createContact(accessToken, lead);

    const followUpErrors: string[] = [];
    let noteCreated = false;
    let taskCreated = false;
    let appointmentCreated = false;

    if (lead.notes) {
      try {
        await hubSpotClient.createNote(accessToken, result.contactId, lead.notes);
        noteCreated = true;
      } catch (error) {
        followUpErrors.push(error instanceof Error ? error.message : 'HubSpot note creation failed');
      }
    }

    if (lead.task?.title && lead.task?.due_date) {
      try {
        await hubSpotClient.createTask(accessToken, result.contactId, {
          title: lead.task.title,
          due_date: lead.task.due_date,
          body: lead.notes,
        });
        taskCreated = true;
      } catch (error) {
        followUpErrors.push(error instanceof Error ? error.message : 'HubSpot task creation failed');
      }
    }

    if (lead.appointment?.date) {
      try {
        await hubSpotClient.createAppointment(accessToken, result.contactId, lead.appointment);
        appointmentCreated = true;
      } catch (error) {
        followUpErrors.push(error instanceof Error ? error.message : 'HubSpot appointment creation failed');
      }
    }

    await upsertHubSpotLink(supabase, requestUser.id, lead.id, result.contactId);
    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'connected',
        last_error: followUpErrors.length ? followUpErrors.join('; ') : null,
      })
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'hubspot');

    return NextResponse.json({
      success: true,
      message: 'Lead synced to HubSpot',
      remoteContactId: result.contactId,
      action: result.action,
      noteCreated,
      taskCreated,
      appointmentCreated,
      followUpErrors: followUpErrors.length ? followUpErrors : undefined,
    });
  } catch (error) {
    console.error('[hubspot/push-lead]', error);

    const status =
      error instanceof HubSpotAPIError && error.kind === 'invalid_token'
        ? 401
        : error instanceof HubSpotAPIError && error.kind === 'network'
          ? 502
          : 500;

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'HubSpot sync failed',
      },
      { status }
    );
  }
}
