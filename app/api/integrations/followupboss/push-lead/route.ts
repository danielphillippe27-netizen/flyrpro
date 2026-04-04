import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getFubAuthForUserWorkspace } from '../_lib/auth';
import {
  extractPersonId,
  FUB_API_BASE,
  getCurrentUserId,
  resolvePersonIdByContact,
  withFubPersonRetry,
} from '../_lib/client';
import { FUB_CONNECTION_PROVIDERS } from '../_lib/provider';

interface LeadData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  message?: string;
  source?: string;
  sourceUrl?: string;
  campaignId?: string;
  metadata?: Record<string, unknown>;
  task?: {
    title?: string;
    due_date?: string;
  };
  appointment?: {
    date?: string;
    title?: string;
    notes?: string;
  };
}

function buildFollowUpNoteBody(leadData: LeadData): string | undefined {
  const msg = leadData.message?.trim();
  if (msg) return msg;
  const parts: string[] = [];
  const title = leadData.appointment?.title?.trim();
  const notes = leadData.appointment?.notes?.trim();
  if (title) parts.push(title);
  if (notes) parts.push(notes);
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

function normalizeDueDateTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes('T')) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T17:00:00.000Z`;
  }

  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString();
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const leadData: LeadData = await request.json();

    // Validate required fields
    if (!leadData.email && !leadData.phone) {
      return NextResponse.json(
        { error: 'Email or phone is required' },
        { status: 400 }
      );
    }

    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const userId = requestUser.id;
    const supabase = createAdminClient();

    let targetWorkspaceId: string | null = null;
    if (leadData.campaignId) {
      const { data: campaignRow } = await supabase
        .from('campaigns')
        .select('workspace_id')
        .eq('id', leadData.campaignId)
        .maybeSingle();
      targetWorkspaceId = campaignRow?.workspace_id ?? null;
    }
    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      userId,
      targetWorkspaceId
    );
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 403 }
      );
    }
    targetWorkspaceId = workspaceResolution.workspaceId;

    const fubAuth = await getFubAuthForUserWorkspace(supabase, userId, targetWorkspaceId);
    if (!fubAuth) {
      return NextResponse.json(
        { error: 'Follow Up Boss not connected. Please connect your account first.' },
        { status: 400 }
      );
    }

    // Prepare the person data
    const person: {
      firstName?: string;
      lastName?: string;
      emails?: Array<{ value: string }>;
      phones?: Array<{ value: string }>;
      addresses?: Array<{ street: string; city: string; state: string; code: string }>;
    } = {};
    if (leadData.firstName || leadData.lastName) {
      person.firstName = leadData.firstName || '';
      person.lastName = leadData.lastName || '';
    }
    if (leadData.email) person.emails = [{ value: leadData.email }];
    if (leadData.phone) person.phones = [{ value: leadData.phone }];
    if (leadData.address || leadData.city || leadData.state || leadData.zip) {
      person.addresses = [{
        street: leadData.address || '',
        city: leadData.city || '',
        state: leadData.state || '',
        code: leadData.zip || '',
      }];
    }

    // Build the event payload according to FUB's recommended format
    const eventPayload: {
      source: string;
      system: string;
      type: string;
      message: string;
      person: typeof person;
      sourceUrl?: string;
      metadata?: Record<string, unknown>;
    } = {
      source: leadData.source || 'FLYR',
      system: 'FLYR',
      type: 'General Inquiry',
      message: leadData.message || `Lead from FLYR campaign${leadData.campaignId ? ` ${leadData.campaignId}` : ''}`,
      person,
    };

    // Add source URL if provided
    if (leadData.sourceUrl) {
      eventPayload.sourceUrl = leadData.sourceUrl;
    }

    // Add any additional metadata
    if (leadData.metadata) {
      eventPayload.metadata = leadData.metadata;
    }

    // Push to Follow Up Boss using POST /v1/events (recommended by FUB)
    const fubResponse = await fetch(`${FUB_API_BASE}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...fubAuth.headers,
      },
      body: JSON.stringify(eventPayload),
    });

    if (!fubResponse.ok) {
      const errorData = await fubResponse.text();
      console.error('FUB API error:', errorData);

      const isExpired =
        fubResponse.status === 401 &&
        /expired|renew|refresh/i.test(errorData);

      // Update connection with error
      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_error: `Push failed: ${fubResponse.status}`,
        })
        .eq('workspace_id', targetWorkspaceId)
        .in('provider', [...FUB_CONNECTION_PROVIDERS]);

      if (isExpired) {
        return NextResponse.json(
          {
            error: 'Follow Up Boss API key has expired. Reconnect in Settings → Integrations.',
            code: 'FUB_TOKEN_EXPIRED',
          },
          { status: 401 }
        );
      }

      return NextResponse.json(
        { error: `Failed to push lead to Follow Up Boss: ${fubResponse.status}` },
        { status: 502 }
      );
    }

    let fubEventId: string | undefined;
    let fubPersonId: number | undefined;
    let fubNoteId: number | undefined;
    let fubTaskId: number | undefined;
    let fubAppointmentId: number | undefined;
    let noteCreated: boolean | undefined;
    let taskCreated: boolean | undefined;
    let appointmentCreated: boolean | undefined;
    const followUpErrors: string[] = [];

    const eventResponseText = await fubResponse.text();
    if (eventResponseText.trim()) {
      try {
        const parsed = JSON.parse(eventResponseText) as Record<string, unknown>;
        fubEventId = parsed.id != null ? String(parsed.id) : undefined;
        fubPersonId = extractPersonId(parsed);
      } catch {
        console.warn('[followupboss/push-lead] Failed to parse /events response JSON');
      }
    }

    if (fubPersonId == null && fubEventId) {
      const eventFetchRes = await fetch(`${FUB_API_BASE}/events/${encodeURIComponent(fubEventId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...fubAuth.headers,
        },
      });
      if (eventFetchRes.ok) {
        try {
          const eventDetails = await eventFetchRes.json();
          fubPersonId = extractPersonId(eventDetails);
        } catch {
          // ignore event decode errors
        }
      }
    }

    if (fubPersonId == null) {
      fubPersonId = await resolvePersonIdByContact(fubAuth.headers, {
        email: leadData.email,
        phone: leadData.phone,
      });
    }

    if (fubPersonId != null) {
      const authHeaders = {
        'Content-Type': 'application/json',
        ...fubAuth.headers,
      };
      const taskTitle = leadData.task?.title?.trim();
      const dueDate = leadData.task?.due_date?.trim();
      const appointmentDateRaw = leadData.appointment?.date?.trim();
      const shouldFetchCurrentUser = Boolean((taskTitle && dueDate) || appointmentDateRaw);
      const noteBody = buildFollowUpNoteBody(leadData);
      let currentUserId: number | undefined;

      if (shouldFetchCurrentUser) {
        currentUserId = await getCurrentUserId(fubAuth.headers).catch(() => undefined);
      }

      if (noteBody) {
        try {
          const noteData = await withFubPersonRetry(async () => {
            const noteRes = await fetch(`${FUB_API_BASE}/notes`, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({
                personId: fubPersonId,
                subject: 'FLYR Note',
                body: noteBody,
              }),
            });
            if (!noteRes.ok) {
              const noteErr = await noteRes.text();
              throw new Error(noteErr || `Note creation failed (${noteRes.status})`);
            }
            try {
              return (await noteRes.json()) as { id?: number };
            } catch {
              return {} as { id?: number };
            }
          });
          noteCreated = true;
          if (noteData?.id != null) {
            fubNoteId = Number(noteData.id);
          }
        } catch (error) {
          const noteErr = error instanceof Error ? error.message : String(error);
          followUpErrors.push(noteErr || 'Note creation failed');
          console.warn('[followupboss/push-lead] Note creation failed', {
            body: noteErr,
            personId: fubPersonId,
          });
        }
      }

      if (taskTitle && dueDate) {
        const dueDateTime = normalizeDueDateTime(dueDate);
        if (!dueDateTime) {
          followUpErrors.push(`Invalid task due_date: "${dueDate}"`);
        } else {
          try {
            const taskData = await withFubPersonRetry(async () => {
              const taskRes = await fetch(`${FUB_API_BASE}/tasks`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                  personId: fubPersonId,
                  name: taskTitle,
                  type: 'Follow Up',
                  dueDate: dueDateTime.slice(0, 10),
                  dueDateTime,
                  ...(currentUserId != null ? { assignedUserId: currentUserId } : {}),
                }),
              });
              if (!taskRes.ok) {
                const taskErr = await taskRes.text();
                throw new Error(taskErr || `Task creation failed (${taskRes.status})`);
              }
              try {
                return (await taskRes.json()) as { id?: number };
              } catch {
                return {} as { id?: number };
              }
            });
            taskCreated = true;
            if (taskData?.id != null) {
              fubTaskId = Number(taskData.id);
            }
          } catch (error) {
            const taskErr = error instanceof Error ? error.message : String(error);
            followUpErrors.push(taskErr || 'Task creation failed');
            console.warn('[followupboss/push-lead] Task creation failed', {
              body: taskErr,
              personId: fubPersonId,
            });
          }
        }
      }

      if (appointmentDateRaw) {
        const startDate = new Date(appointmentDateRaw);
        if (!Number.isNaN(startDate.getTime())) {
          const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
          try {
            const appointmentData = await withFubPersonRetry(async () => {
              const appointmentRes = await fetch(`${FUB_API_BASE}/appointments`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                  title: leadData.appointment?.title?.trim() || 'FLYR Appointment',
                  start: startDate.toISOString(),
                  end: endDate.toISOString(),
                  ...(leadData.appointment?.notes?.trim()
                    ? { description: leadData.appointment.notes.trim() }
                    : {}),
                  invitees: [
                    { personId: fubPersonId },
                    ...(currentUserId != null ? [{ userId: currentUserId }] : []),
                  ],
                }),
              });
              if (!appointmentRes.ok) {
                const appointmentErr = await appointmentRes.text();
                throw new Error(appointmentErr || `Appointment creation failed (${appointmentRes.status})`);
              }
              try {
                return (await appointmentRes.json()) as { id?: number };
              } catch {
                return {} as { id?: number };
              }
            });
            appointmentCreated = true;
            if (appointmentData?.id != null) {
              fubAppointmentId = Number(appointmentData.id);
            }
          } catch (error) {
            const appointmentErr = error instanceof Error ? error.message : String(error);
            followUpErrors.push(appointmentErr || 'Appointment creation failed');
            console.warn('[followupboss/push-lead] Appointment creation failed', {
              body: appointmentErr,
              personId: fubPersonId,
            });
          }
        } else {
          followUpErrors.push(`Invalid appointment date: "${appointmentDateRaw}"`);
        }
      }
    } else {
      const hasFollowUps =
        Boolean(leadData.message?.trim()) ||
        Boolean(leadData.task?.title?.trim()) ||
        Boolean(leadData.appointment?.date?.trim()) ||
        Boolean(leadData.appointment?.title?.trim()) ||
        Boolean(leadData.appointment?.notes?.trim());
      if (hasFollowUps) {
        followUpErrors.push(
          'Lead event created but personId could not be resolved, so notes/tasks/appointments were skipped.'
        );
      }
    }

    // Update last_push_at timestamp
    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('workspace_id', targetWorkspaceId)
      .in('provider', [...FUB_CONNECTION_PROVIDERS]);

    // Save lead to contacts so it shows on the web Leads page (iOS and other push-lead callers)
    const fullName = [leadData.firstName, leadData.lastName].filter(Boolean).join(' ').trim() || (leadData.email || leadData.phone || 'Lead');
    const addressStr = [leadData.address, leadData.city, leadData.state, leadData.zip].filter(Boolean).join(', ');
    await supabase.from('contacts').insert({
      user_id: userId,
      workspace_id: targetWorkspaceId,
      full_name: fullName,
      phone: leadData.phone || null,
      email: leadData.email || null,
      address: addressStr || '',
      campaign_id: leadData.campaignId || null,
      status: 'new',
      notes: leadData.message || null,
    });

    return NextResponse.json({
      success: true,
      message: 'Lead successfully pushed to Follow Up Boss',
      fubEventId: fubEventId ?? null,
      fubPersonId: fubPersonId ?? null,
      fubNoteId: fubNoteId ?? null,
      fubTaskId: fubTaskId ?? null,
      fubAppointmentId: fubAppointmentId ?? null,
      noteCreated,
      taskCreated,
      appointmentCreated,
      followUpErrors: followUpErrors.length ? followUpErrors : undefined,
    });
  } catch (error) {
    console.error('Error pushing lead to FUB:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to push lead' },
      { status: 500 }
    );
  }
}
