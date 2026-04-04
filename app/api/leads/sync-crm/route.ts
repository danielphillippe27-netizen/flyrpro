import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getFubAuthForUserWorkspace } from '@/app/api/integrations/followupboss/_lib/auth';
import { isFubConnectionProvider } from '@/app/api/integrations/followupboss/_lib/provider';
import { getBoldTrailTokenForWorkspace } from '@/app/api/integrations/boldtrail/_lib/auth';
import {
  BoldTrailAPIClient,
  buildBoldTrailFollowUpNote,
} from '@/app/api/integrations/boldtrail/_lib/client';
import {
  buildMondayColumnValues,
  createMondayItem,
  createMondayUpdate,
  fetchMondayBoards,
  resolveMondayColumnMapping,
  updateMondayItem,
  validateMondayBoardSelection,
  type MondayBoard,
  type MondayColumnMappingEntry,
} from '@/app/api/integrations/monday/_lib/client';
import { getHubSpotAuthForUserWorkspace } from '@/app/api/integrations/hubspot/_lib/auth';
import { HubSpotAPIClient } from '@/app/api/integrations/hubspot/_lib/client';
import { getZapierWebhookUrlForWorkspace } from '@/app/api/integrations/zapier/_lib/auth';
import { ZapierWebhookClient } from '@/app/api/integrations/zapier/_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const boldTrailClient = new BoldTrailAPIClient();
const hubSpotClient = new HubSpotAPIClient();
const zapierClient = new ZapierWebhookClient();

/** Split "First Last" into { firstName, lastName } */
function splitFullName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  if (!fullName || !fullName.trim()) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

type ContactRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  campaign_id: string | null;
  notes: string | null;
};

/**
 * POST /api/leads/sync-crm
 * Syncs the current user's leads/contacts to connected CRMs.
 */
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
      // no-op: body may be empty
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
      .select('id, access_token, account_id, account_name, selected_board_id, selected_board_name, provider_config')
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

    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, full_name, phone, email, address, campaign_id, notes')
      .eq('workspace_id', targetWorkspaceId);

    if (error) {
      console.error('Sync CRM: fetch contacts error', error);
      return NextResponse.json(
        { error: 'Failed to load leads' },
        { status: 500 }
      );
    }

    const list: ContactRow[] = contacts ?? [];
    if (list.length === 0) {
      return NextResponse.json({
        message: 'No leads to sync.',
        count: 0,
        failed: 0,
        details: {},
      });
    }

    const details: Record<string, { synced: number; failed: number; error?: string }> = {};
    const providerNames: Record<string, string> = {
      boldtrail: 'BoldTrail / kvCORE',
      followupboss: 'Follow Up Boss',
      hubspot: 'HubSpot',
      monday: 'Monday.com',
      zapier: 'Zapier',
    };

    for (const conn of connections ?? []) {
      const provider = conn.provider as string;
      if (!isFubConnectionProvider(provider)) continue;

      const detailsKey = 'followupboss';

      let synced = 0;
      let failed = 0;
      const fubAuth = await getFubAuthForUserWorkspace(supabase, userId, targetWorkspaceId);
      if (!fubAuth) {
        details[detailsKey] = { synced: 0, failed: list.length };
        continue;
      }

      for (const c of list) {
        if (!c.email && !c.phone) {
          failed++;
          continue;
        }

        const { firstName, lastName } = splitFullName(c.full_name);
        const person: Record<string, unknown> = {};
        if (firstName || lastName) {
          person.firstName = firstName;
          person.lastName = lastName;
        }
        if (c.email) person.emails = [{ value: c.email }];
        if (c.phone) person.phones = [{ value: c.phone }];
        if (c.address) person.addresses = [{ street: c.address, city: '', state: '', code: '' }];
        const eventPayload = {
          source: 'FLYR',
          system: 'FLYR',
          type: 'General Inquiry',
          message: c.notes
            ? `FLYR lead${c.campaign_id ? ` (campaign ${c.campaign_id})` : ''}: ${c.notes}`
            : `Lead from FLYR${c.campaign_id ? ` campaign ${c.campaign_id}` : ''}`,
          person,
        };
        const fubRes = await fetch('https://api.followupboss.com/v1/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...fubAuth.headers,
          },
          body: JSON.stringify(eventPayload),
        });
        if (!fubRes.ok) {
          console.error('FUB push failed for contact', c.id, fubRes.status);
          failed++;
        } else {
          synced++;
        }
      }

      details[detailsKey] = { synced, failed };

      if (synced > 0 || failed > 0) {
        await supabase
          .from('crm_connections')
          .update({
            last_push_at: new Date().toISOString(),
            status: 'connected',
            last_error: null,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', provider);
      }
    }

    if (hasBoldTrail) {
      let synced = 0;
      let failed = 0;

      try {
        for (const contact of list) {
          if (!contact.email && !contact.phone) {
            failed++;
            continue;
          }

          try {
            await syncContactToBoldTrail(supabase, userId, targetWorkspaceId, contact);
            synced++;
          } catch (error) {
            failed++;
            console.error('[leads/sync-crm] boldtrail sync failed for contact', contact.id, error);
          }
        }

        details.boldtrail = { synced, failed };

        await supabase
          .from('crm_connections')
          .update({
            last_push_at: new Date().toISOString(),
            status: 'connected',
            last_error: failed > 0 ? 'One or more BoldTrail syncs failed.' : null,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'boldtrail');
      } catch (error) {
        console.error('[leads/sync-crm] boldtrail setup failed', error);
        details.boldtrail = {
          synced: 0,
          failed: list.length,
          error: error instanceof Error ? error.message : 'BoldTrail sync setup failed',
        };

        await supabase
          .from('crm_connections')
          .update({
            updated_at: new Date().toISOString(),
            last_error: error instanceof Error ? error.message : 'BoldTrail sync setup failed',
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'boldtrail');
      }
    }

    if (hasMonday) {
      try {
        const mondayContext = await buildMondaySyncContext(supabase, userId, mondayIntegration);
        if (!mondayContext) {
          details.monday = {
            synced: 0,
            failed: list.length,
            error: 'Monday.com is connected but no board is selected.',
          };
        } else {
          let synced = 0;
          let failed = 0;
          for (const contact of list) {
            try {
              await syncContactToMonday(supabase, userId, contact, mondayContext);
              synced++;
            } catch (error) {
              failed++;
              console.error('[leads/sync-crm] monday sync failed for contact', contact.id, error);
            }
          }
          details.monday = { synced, failed };
        }
      } catch (error) {
        console.error('[leads/sync-crm] monday setup failed', error);
        details.monday = {
          synced: 0,
          failed: list.length,
          error: error instanceof Error ? error.message : 'Monday sync setup failed',
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

        let synced = 0;
        let failed = 0;
        for (const contact of list) {
          try {
            await syncContactToHubSpot(supabase, userId, accessToken, contact);
            synced++;
          } catch (error) {
            failed++;
            console.error('[leads/sync-crm] hubspot sync failed for contact', contact.id, error);
          }
        }

        details.hubspot = { synced, failed };

        await supabase
          .from('crm_connections')
          .update({
            last_push_at: new Date().toISOString(),
            status: 'connected',
            last_error: failed > 0 ? 'One or more HubSpot syncs failed.' : null,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'hubspot');
      } catch (error) {
        console.error('[leads/sync-crm] hubspot setup failed', error);
        details.hubspot = {
          synced: 0,
          failed: list.length,
          error: error instanceof Error ? error.message : 'HubSpot sync setup failed',
        };

        await supabase
          .from('crm_connections')
          .update({
            updated_at: new Date().toISOString(),
            last_error: error instanceof Error ? error.message : 'HubSpot sync setup failed',
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'hubspot');
      }
    }

    if (hasZapier) {
      try {
        const webhookUrl = await getZapierWebhookUrlForWorkspace(supabase, targetWorkspaceId);
        if (!webhookUrl) {
          throw new Error('Zapier webhook not found');
        }

        let synced = 0;
        let failed = 0;
        for (const contact of list) {
          try {
            await zapierClient.sendLead(webhookUrl, targetWorkspaceId, {
              id: contact.id,
              name: contact.full_name,
              email: contact.email,
              phone: contact.phone,
              address: contact.address,
              notes: contact.notes,
              source: 'FLYR',
              campaignId: contact.campaign_id,
            });
            synced++;
          } catch (error) {
            failed++;
            console.error('[leads/sync-crm] zapier sync failed for contact', contact.id, error);
          }
        }

        details.zapier = { synced, failed };

        await supabase
          .from('crm_connections')
          .update({
            last_push_at: new Date().toISOString(),
            status: 'connected',
            last_error: failed > 0 ? 'One or more Zapier syncs failed.' : null,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'zapier');
      } catch (error) {
        console.error('[leads/sync-crm] zapier setup failed', error);
        details.zapier = {
          synced: 0,
          failed: list.length,
          error: error instanceof Error ? error.message : 'Zapier sync setup failed',
        };

        await supabase
          .from('crm_connections')
          .update({
            updated_at: new Date().toISOString(),
            last_error: error instanceof Error ? error.message : 'Zapier sync setup failed',
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', 'zapier');
      }
    }

    const parts: string[] = [];
    for (const [provider, d] of Object.entries(details)) {
      const label = providerNames[provider] ?? provider;
      parts.push(`${d.synced} to ${label}`);
    }
    const totalSynced = Object.values(details).reduce((sum, d) => sum + d.synced, 0);
    const totalFailed = Object.values(details).reduce((sum, d) => sum + d.failed, 0);
    const message = parts.length
      ? `Synced: ${parts.join('; ')}.${totalFailed > 0 ? ` ${totalFailed} failed.` : ''}`
      : 'No leads to sync.';

    return NextResponse.json({
      message,
      count: totalSynced,
      failed: totalFailed,
      total: list.length,
      details,
    });
  } catch (e) {
    console.error('Sync to CRM error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Sync to CRM failed.' },
      { status: 500 }
    );
  }
}

type MondayIntegrationRow = {
  access_token: string | null;
  selected_board_id: string | null;
  selected_board_name: string | null;
  provider_config: { columnMapping?: Record<string, MondayColumnMappingEntry> } | null;
};

async function buildMondaySyncContext(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  integration: MondayIntegrationRow | null
): Promise<{
  accessToken: string;
  board: MondayBoard;
  mapping: Record<string, MondayColumnMappingEntry>;
} | null> {
  if (!integration?.access_token) return null;
  if (!integration.selected_board_id) {
    console.log('[leads/sync-crm] monday connected without board selection', { userId });
    return null;
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

  console.log('[leads/sync-crm] monday mapping resolved', {
    userId,
    boardId: board.id,
    mappedFields: Object.keys(mapping),
  });

  return {
    accessToken: integration.access_token,
    board,
    mapping,
  };
}

async function syncContactToMonday(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  contact: ContactRow,
  context: {
    accessToken: string;
    board: MondayBoard;
    mapping: Record<string, MondayColumnMappingEntry>;
  }
) {
  const itemName = contact.full_name?.trim() || contact.email?.trim() || contact.phone?.trim() || 'FLYR Lead';
  const columnValues = buildMondayColumnValues(
    {
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      notes: contact.notes,
    },
    context.board.columns,
    context.mapping
  );

  const existingItemId = await findExistingMondayItemId(supabase, userId, contact.id);
  let mondayItemId: string;
  if (existingItemId) {
    await updateMondayItem(context.accessToken, context.board.id, existingItemId, columnValues);
    mondayItemId = existingItemId;
    console.log('[leads/sync-crm] monday item updated', {
      userId,
      boardId: context.board.id,
      itemId: mondayItemId,
      contactId: contact.id,
    });
  } else {
    mondayItemId = await createMondayItem(context.accessToken, context.board.id, itemName, columnValues);
    console.log('[leads/sync-crm] monday item created', {
      userId,
      boardId: context.board.id,
      itemId: mondayItemId,
      contactId: contact.id,
    });
  }

  const notesMapping = context.mapping.notes;
  if (contact.notes?.trim() && notesMapping?.strategy === 'update_comment') {
    await createMondayUpdate(context.accessToken, mondayItemId, contact.notes.trim());
  }

  await upsertMondayLink(supabase, userId, contact.id, mondayItemId, context.board.id, context.board.name);
}

async function syncContactToBoldTrail(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  workspaceId: string,
  contact: ContactRow
) {
  const accessToken = await getBoldTrailTokenForWorkspace(supabase, workspaceId);
  if (!accessToken) {
    throw new Error('BoldTrail token not found');
  }

  const existingContactId = await findExistingBoldTrailContactId(supabase, userId, contact.id);

  let remoteContactId = existingContactId;
  if (existingContactId) {
    await boldTrailClient.updateContact(accessToken, existingContactId, {
      id: contact.id,
      name: contact.full_name,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      source: 'FLYR',
      notes: contact.notes,
    });
  } else {
    const created = await boldTrailClient.createContact(accessToken, {
      id: contact.id,
      name: contact.full_name,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      source: 'FLYR',
      notes: contact.notes,
    });
    remoteContactId = created.contactId;
  }

  if (!remoteContactId) {
    throw new Error('BoldTrail did not return a contact ID');
  }

  const followUpNote = buildBoldTrailFollowUpNote(contact.notes);
  if (followUpNote) {
    try {
      await boldTrailClient.addNote(accessToken, remoteContactId, followUpNote);
    } catch (error) {
      console.warn('[leads/sync-crm] boldtrail follow-up note failed', {
        contactId: contact.id,
        remoteContactId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  await upsertBoldTrailLink(supabase, userId, contact.id, remoteContactId);
}

async function syncContactToHubSpot(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  accessToken: string,
  contact: ContactRow
) {
  let existingContactId = await findExistingHubSpotContactId(supabase, userId, contact.id);
  if (!existingContactId && contact.email) {
    existingContactId = await hubSpotClient.findContactByEmail(accessToken, contact.email);
  }
  if (!existingContactId && contact.phone) {
    existingContactId = await hubSpotClient.findContactByPhone(accessToken, contact.phone);
  }

  const result = existingContactId
    ? await hubSpotClient.updateContact(accessToken, existingContactId, {
        id: contact.id,
        name: contact.full_name,
        phone: contact.phone,
        email: contact.email,
        address: contact.address,
        notes: contact.notes,
        source: 'FLYR',
      })
    : await hubSpotClient.createContact(accessToken, {
        id: contact.id,
        name: contact.full_name,
        phone: contact.phone,
        email: contact.email,
        address: contact.address,
        notes: contact.notes,
        source: 'FLYR',
      });

  await upsertHubSpotLink(supabase, userId, contact.id, result.contactId);
}

async function findExistingMondayItemId(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string
) {
  const { data, error } = await supabase
    .from('crm_object_links')
    .select('id, remote_object_id')
    .eq('user_id', userId)
    .eq('crm_type', 'monday')
    .eq('flyr_lead_id', leadId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data?.remote_object_id ? String(data.remote_object_id) : null;
}

async function findExistingBoldTrailContactId(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string
) {
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

async function findExistingHubSpotContactId(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string
) {
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

async function upsertMondayLink(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string,
  itemId: string,
  boardId: string,
  boardName: string
) {
  const { data: existing, error: existingError } = await supabase
    .from('crm_object_links')
    .select('id')
    .eq('user_id', userId)
    .eq('crm_type', 'monday')
    .eq('flyr_lead_id', leadId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const payload = {
    remote_object_id: itemId,
    remote_object_type: 'item',
    remote_metadata: {
      boardId,
      boardName,
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
      crm_type: 'monday',
      flyr_lead_id: leadId,
      ...payload,
    });

  if (error) throw error;
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
