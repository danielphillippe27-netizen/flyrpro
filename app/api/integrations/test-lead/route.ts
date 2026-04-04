import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getFubAuthForUserWorkspace } from '@/app/api/integrations/followupboss/_lib/auth';
import {
  FUB_CONNECTION_PROVIDERS,
  isFubConnectionProvider,
} from '@/app/api/integrations/followupboss/_lib/provider';
import { getBoldTrailTokenForWorkspace } from '@/app/api/integrations/boldtrail/_lib/auth';
import {
  BoldTrailAPIClient,
  buildBoldTrailAppointmentNote,
  buildBoldTrailFollowUpNote,
} from '@/app/api/integrations/boldtrail/_lib/client';
import {
  buildMondayColumnValues,
  createMondayItem,
  fetchMondayBoards,
  resolveMondayColumnMapping,
  validateMondayBoardSelection,
} from '@/app/api/integrations/monday/_lib/client';
import { getHubSpotAuthForUserWorkspace } from '@/app/api/integrations/hubspot/_lib/auth';
import { HubSpotAPIClient } from '@/app/api/integrations/hubspot/_lib/client';
import { getZapierWebhookUrlForWorkspace } from '@/app/api/integrations/zapier/_lib/auth';
import { ZapierWebhookClient } from '@/app/api/integrations/zapier/_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MondayIntegrationRow = {
  access_token: string | null;
  selected_board_id: string | null;
  provider_config: {
    columnMapping?: Record<string, unknown>;
  } | null;
};

type ProviderResult = {
  success: boolean;
  error?: string;
  warning?: string;
};

const boldTrailClient = new BoldTrailAPIClient();
const hubSpotClient = new HubSpotAPIClient();
const zapierClient = new ZapierWebhookClient();

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = requestUser.id;
    const supabase = createAdminClient();

    let workspaceId: string | null = null;
    try {
      const body = await request.json();
      workspaceId = body?.workspaceId ?? null;
    } catch {
      workspaceId = null;
    }

    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      userId,
      workspaceId
    );
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }
    const targetWorkspaceId = workspaceResolution.workspaceId;

    const { data: connections } = await supabase
      .from('crm_connections')
      .select('provider')
      .eq('workspace_id', targetWorkspaceId)
      .eq('status', 'connected');

    const { data: mondayIntegration } = await supabase
      .from('user_integrations')
      .select('access_token, selected_board_id, provider_config')
      .eq('user_id', userId)
      .eq('provider', 'monday')
      .maybeSingle();

    const hasFub = (connections ?? []).some((connection) => isFubConnectionProvider(connection.provider));
    const hasBoldTrail = (connections ?? []).some((connection) => connection.provider === 'boldtrail');
    const hasHubSpot = (connections ?? []).some((connection) => connection.provider === 'hubspot');
    const hasZapier = (connections ?? []).some((connection) => connection.provider === 'zapier');
    const hasMonday = !!mondayIntegration?.access_token;

    if (!hasFub && !hasBoldTrail && !hasHubSpot && !hasZapier && !hasMonday) {
      return NextResponse.json(
        { error: 'No CRM connected. Connect a CRM in Settings → Integrations first.' },
        { status: 400 }
      );
    }

    const uniqueSuffix = Date.now();
    const testLead = {
      id: `test-${uniqueSuffix}`,
      name: 'Test Lead',
      email: `test-${uniqueSuffix}@example.com`,
      phone: '(555) 123-4567',
      address: '123 Test Street',
      notes: 'Test lead from FLYR Integrations to verify CRM setup.',
      source: 'FLYR Integration Test',
    };
    const appointmentDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const details: Record<string, ProviderResult> = {};

    if (hasFub) {
      try {
        const fubAuth = await getFubAuthForUserWorkspace(supabase, userId, targetWorkspaceId);
        if (!fubAuth) {
          throw new Error('Follow Up Boss auth not found');
        }

        const payload = {
          source: 'FLYR',
          system: 'FLYR',
          type: 'General Inquiry',
          message: 'Test lead from FLYR Integration - This is a test to verify your connection is working',
          person: {
            firstName: 'Test',
            lastName: 'Lead',
            emails: [{ value: testLead.email }],
            phones: [{ value: testLead.phone }],
          },
          metadata: {
            testLead: true,
            sentAt: new Date().toISOString(),
            source: 'FLYR Integration Test',
          },
        };

        const fubResponse = await fetch('https://api.followupboss.com/v1/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...fubAuth.headers,
          },
          body: JSON.stringify(payload),
        });

        if (!fubResponse.ok) {
          throw new Error(`Follow Up Boss returned ${fubResponse.status}`);
        }

        await supabase
          .from('crm_connections')
          .update({
            last_push_at: new Date().toISOString(),
            status: 'connected',
            last_error: null,
          })
          .eq('workspace_id', targetWorkspaceId)
          .in('provider', [...FUB_CONNECTION_PROVIDERS]);

        details.followupboss = { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Follow Up Boss test lead failed';
        await supabase
          .from('crm_connections')
          .update({
            last_error: message,
          })
          .eq('workspace_id', targetWorkspaceId)
          .in('provider', [...FUB_CONNECTION_PROVIDERS]);
        details.followupboss = { success: false, error: message };
      }
    }

    if (hasBoldTrail) {
      try {
        const accessToken = await getBoldTrailTokenForWorkspace(supabase, targetWorkspaceId);
        if (!accessToken) {
          throw new Error('BoldTrail token not found');
        }

        const created = await boldTrailClient.createContact(accessToken, testLead);
        const followUpNote = buildBoldTrailFollowUpNote({
          dueDate: appointmentDate,
          notes: 'Follow up with this test lead to confirm the integration is writing notes correctly.',
        });
        const appointmentNote = buildBoldTrailAppointmentNote({
          title: 'Integration Test Appointment',
          date: appointmentDate,
          notes: 'This is a placeholder appointment note created by FLYR because kvCORE/BoldTrail does not expose a native appointment action in the public API.',
        });

        const noteWarnings: string[] = [];
        if (followUpNote) {
          try {
            await boldTrailClient.addNote(accessToken, created.contactId, followUpNote);
          } catch (error) {
            noteWarnings.push(
              `follow-up note failed: ${error instanceof Error ? error.message : 'unknown error'}`
            );
          }
        }
        if (appointmentNote) {
          try {
            await boldTrailClient.addNote(accessToken, created.contactId, appointmentNote);
          } catch (error) {
            noteWarnings.push(
              `appointment note failed: ${error instanceof Error ? error.message : 'unknown error'}`
            );
          }
        }

        await supabase
          .from('crm_connections')
          .update({
            last_push_at: new Date().toISOString(),
            status: 'connected',
            last_error: noteWarnings.length ? noteWarnings.join('; ') : null,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'boldtrail');

        details.boldtrail = {
          success: true,
          warning: noteWarnings.length ? noteWarnings.join('; ') : undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'BoldTrail test lead failed';
        await supabase
          .from('crm_connections')
          .update({
            last_error: message,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'boldtrail');
        details.boldtrail = { success: false, error: message };
      }
    }

    if (hasMonday) {
      try {
        await sendTestLeadToMonday(mondayIntegration, testLead);
        details.monday = { success: true };
      } catch (error) {
        details.monday = {
          success: false,
          error: error instanceof Error ? error.message : 'Monday.com test lead failed',
        };
      }
    }

    if (hasHubSpot) {
      try {
        const hubSpotAuth = await getHubSpotAuthForUserWorkspace(supabase, userId);
        if (!hubSpotAuth) {
          throw new Error('HubSpot auth not found');
        }
        const accessToken = hubSpotAuth.headers.Authorization.replace('Bearer ', '');

        const result = await hubSpotClient.createContact(accessToken, {
          id: testLead.id,
          name: testLead.name,
          email: testLead.email,
          phone: testLead.phone,
          address: testLead.address,
          notes: testLead.notes,
          source: testLead.source,
        });

        const hubSpotWarnings: string[] = [];

        try {
          await hubSpotClient.createNote(accessToken, result.contactId, testLead.notes);
        } catch (error) {
          hubSpotWarnings.push(
            `note failed: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }

        try {
          await hubSpotClient.createTask(accessToken, result.contactId, {
            title: 'FLYR Test Follow-up',
            due_date: appointmentDate,
            body: 'Follow up with this test lead to confirm the integration is writing HubSpot tasks correctly.',
          });
        } catch (error) {
          hubSpotWarnings.push(
            `follow-up task failed: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }

        try {
          await hubSpotClient.createAppointment(accessToken, result.contactId, {
            date: appointmentDate,
            title: 'FLYR Test Appointment',
            notes: 'This is a test appointment created by FLYR to verify the HubSpot appointment integration.',
            location: 'FLYR Integration Test',
          });
        } catch (error) {
          hubSpotWarnings.push(
            `appointment failed: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }

        await supabase
          .from('crm_connections')
          .update({
            last_push_at: new Date().toISOString(),
            status: 'connected',
            last_error: hubSpotWarnings.length ? hubSpotWarnings.join('; ') : null,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'hubspot');

        details.hubspot = {
          success: true,
          warning: [
            result.action === 'updated' ? 'Test lead updated an existing HubSpot contact.' : null,
            hubSpotWarnings.length ? hubSpotWarnings.join('; ') : null,
          ]
            .filter(Boolean)
            .join(' ') || undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'HubSpot test lead failed';
        await supabase
          .from('crm_connections')
          .update({
            last_error: message,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'hubspot');
        details.hubspot = { success: false, error: message };
      }
    }

    if (hasZapier) {
      try {
        const webhookUrl = await getZapierWebhookUrlForWorkspace(supabase, targetWorkspaceId);
        if (!webhookUrl) {
          throw new Error('Zapier webhook not found');
        }

        await zapierClient.sendTestLead(webhookUrl, targetWorkspaceId, {
          id: testLead.id,
          name: testLead.name,
          email: testLead.email,
          phone: testLead.phone,
          address: testLead.address,
          notes: testLead.notes,
          source: testLead.source,
          createdAt: new Date().toISOString(),
        });

        await supabase
          .from('crm_connections')
          .update({
            last_push_at: new Date().toISOString(),
            status: 'connected',
            last_error: null,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'zapier');

        details.zapier = { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Zapier test lead failed';
        await supabase
          .from('crm_connections')
          .update({
            last_error: message,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'zapier');
        details.zapier = { success: false, error: message };
      }
    }

    const succeeded = Object.entries(details)
      .filter(([, result]) => result.success)
      .map(([provider]) => humanizeProvider(provider));

    const warnings = Object.entries(details)
      .filter(([, result]) => result.warning)
      .map(([provider, result]) => `${humanizeProvider(provider)} (${result.warning})`);

    const failed = Object.entries(details)
      .filter(([, result]) => !result.success)
      .map(([provider, result]) => `${humanizeProvider(provider)}${result.error ? ` (${result.error})` : ''}`);

    if (!succeeded.length) {
      return NextResponse.json(
        {
          error: failed.length ? `Test lead failed: ${failed.join('; ')}` : 'Test lead failed.',
          details,
        },
        { status: 502 }
      );
    }

    const message =
      failed.length > 0
        ? `Test lead sent to ${succeeded.join(', ')}.${warnings.length ? ` Warnings: ${warnings.join('; ')}.` : ''} Failed: ${failed.join('; ')}.`
        : `Test lead sent to ${succeeded.join(', ')}.${warnings.length ? ` Warnings: ${warnings.join('; ')}.` : ''}`;

    return NextResponse.json({
      success: true,
      message,
      testLead: {
        name: testLead.name,
        email: testLead.email,
      },
      details,
    });
  } catch (error) {
    console.error('[integrations/test-lead]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send test lead' },
      { status: 500 }
    );
  }
}

async function sendTestLeadToMonday(
  integration: MondayIntegrationRow | null,
  testLead: {
    name: string;
    email: string;
    phone: string;
    address: string;
    notes: string;
  }
) {
  if (!integration?.access_token) {
    throw new Error('Monday.com access token not found');
  }

  if (!integration.selected_board_id) {
    throw new Error('Monday.com is connected but no board is selected');
  }

  const boards = await fetchMondayBoards(integration.access_token);
  const board = boards.find((candidate) => candidate.id === integration.selected_board_id);
  if (!board) {
    throw new Error('Selected monday board could not be loaded.');
  }

  await validateMondayBoardSelection(integration.access_token, board.id);

  const mapping = resolveMondayColumnMapping(
    board.columns,
    integration.provider_config?.columnMapping ?? null
  );

  const columnValues = buildMondayColumnValues(
    {
      phone: testLead.phone,
      email: testLead.email,
      address: testLead.address,
      notes: testLead.notes,
    },
    board.columns,
    mapping
  );

  await createMondayItem(integration.access_token, board.id, `${testLead.name} ${new Date().toLocaleTimeString()}`, columnValues);
}

function humanizeProvider(provider: string): string {
  if (provider === 'followupboss' || provider === 'fub') return 'Follow Up Boss';
  if (provider === 'boldtrail') return 'BoldTrail / kvCORE';
  if (provider === 'hubspot') return 'HubSpot';
  if (provider === 'monday') return 'Monday.com';
  if (provider === 'zapier') return 'Zapier';
  return provider;
}
