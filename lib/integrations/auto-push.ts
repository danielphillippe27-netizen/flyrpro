/**
 * auto-push.ts
 *
 * Push a single newly-saved contact to every connected CRM immediately after
 * it is written to the DB. Called from /api/contacts and /api/leads/upsert.
 *
 * Server-side only.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { getFubAuthForUserWorkspace } from '@/app/api/integrations/followupboss/_lib/auth';
import { isFubConnectionProvider } from '@/app/api/integrations/followupboss/_lib/provider';
import { getBoldTrailTokenForWorkspace } from '@/app/api/integrations/boldtrail/_lib/auth';
import {
  BoldTrailAPIClient,
  buildBoldTrailFollowUpNote,
} from '@/app/api/integrations/boldtrail/_lib/client';
import { getHubSpotAuthForUserWorkspace } from '@/app/api/integrations/hubspot/_lib/auth';
import { HubSpotAPIClient } from '@/app/api/integrations/hubspot/_lib/client';
import { getZapierWebhookUrlForWorkspace } from '@/app/api/integrations/zapier/_lib/auth';
import { ZapierWebhookClient } from '@/app/api/integrations/zapier/_lib/client';
import { CONTRACTOR_PROVIDER_IDS } from '@/lib/integrations/catalog';
import {
  getContractorAuthForWorkspace,
  getContractorDisplayName,
  pushContractorLead,
  type ContractorProviderId,
} from '@/app/api/integrations/_lib/contractor-providers';
import {
  fetchMondayBoards,
  validateMondayBoardSelection,
  resolveMondayColumnMapping,
  buildMondayColumnValues,
  createMondayItem,
  updateMondayItem,
  createMondayUpdate,
  type MondayColumnMappingEntry,
} from '@/app/api/integrations/monday/_lib/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CrmPushResult = {
  provider: string;
  displayName: string;
  status: 'synced' | 'failed' | 'skipped';
  ms?: number;
  error?: string;
};

export type AutoPushContact = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  campaign_id: string | null;
};

// ─── Shared instances ─────────────────────────────────────────────────────────

const boldTrailClient = new BoldTrailAPIClient();
const hubSpotClient = new HubSpotAPIClient();
const zapierClient = new ZapierWebhookClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitFullName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  if (!fullName?.trim()) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  return parts.length === 1
    ? { firstName: parts[0], lastName: '' }
    : { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`CRM push timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function findExistingRemoteId(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string,
  crmType: string
): Promise<string | null> {
  const { data } = await supabase
    .from('crm_object_links')
    .select('remote_object_id')
    .eq('user_id', userId)
    .eq('crm_type', crmType)
    .eq('flyr_lead_id', leadId)
    .maybeSingle();
  return data?.remote_object_id ? String(data.remote_object_id) : null;
}

async function upsertRemoteLink(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  leadId: string,
  crmType: string,
  remoteObjectId: string,
  remoteObjectType: string,
  remoteMetadata?: Record<string, unknown>
) {
  const { data: existing } = await supabase
    .from('crm_object_links')
    .select('id')
    .eq('user_id', userId)
    .eq('crm_type', crmType)
    .eq('flyr_lead_id', leadId)
    .maybeSingle();

  const payload = {
    remote_object_id: remoteObjectId,
    remote_object_type: remoteObjectType,
    remote_metadata: remoteMetadata ?? { provider: crmType },
    fub_person_id: null,
  };

  if (existing?.id) {
    await supabase.from('crm_object_links').update(payload).eq('id', existing.id);
  } else {
    await supabase.from('crm_object_links').insert({
      user_id: userId,
      crm_type: crmType,
      flyr_lead_id: leadId,
      ...payload,
    });
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Push a single contact to every CRM connected to the given workspace.
 * Runs all providers in parallel; never throws — failures are captured per-provider.
 */
export async function pushLeadToConnectedCrms(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  workspaceId: string,
  contact: AutoPushContact
): Promise<CrmPushResult[]> {
  // Fetch connected providers from crm_connections
  const { data: connections } = await supabase
    .from('crm_connections')
    .select('provider')
    .eq('workspace_id', workspaceId)
    .eq('status', 'connected');

  const connectedProviders = new Set((connections ?? []).map((c) => String(c.provider)));

  // Monday is stored in user_integrations, not crm_connections
  const { data: mondayRow } = await supabase
    .from('user_integrations')
    .select('access_token, selected_board_id, selected_board_name, provider_config')
    .eq('user_id', userId)
    .eq('provider', 'monday')
    .maybeSingle();

  const hasFub = [...connectedProviders].some((p) => isFubConnectionProvider(p));
  const hasBoldTrail = connectedProviders.has('boldtrail');
  const hasHubSpot = connectedProviders.has('hubspot');
  const hasZapier = connectedProviders.has('zapier');
  const hasMonday = !!mondayRow?.access_token && !!mondayRow?.selected_board_id;
  const contractorProviders = CONTRACTOR_PROVIDER_IDS.filter((p) =>
    connectedProviders.has(p)
  ) as ContractorProviderId[];

  const tasks: Array<() => Promise<CrmPushResult>> = [];

  // ── Follow Up Boss ──────────────────────────────────────────────────────────
  if (hasFub) {
    tasks.push(async () => {
      const start = Date.now();
      try {
        const auth = await getFubAuthForUserWorkspace(supabase, userId, workspaceId);
        if (!auth) return { provider: 'followupboss', displayName: 'Follow Up Boss', status: 'skipped' };

        const { firstName, lastName } = splitFullName(contact.full_name);
        const person: Record<string, unknown> = {};
        if (firstName || lastName) { person.firstName = firstName; person.lastName = lastName; }
        if (contact.email) person.emails = [{ value: contact.email }];
        if (contact.phone) person.phones = [{ value: contact.phone }];
        if (contact.address) person.addresses = [{ street: contact.address, city: '', state: '', code: '' }];

        const res = await withTimeout(
          fetch('https://api.followupboss.com/v1/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth.headers },
            body: JSON.stringify({
              source: 'WolfGrid',
              system: 'WolfGrid',
              type: 'General Inquiry',
              message: contact.notes
                ? `WolfGrid lead${contact.campaign_id ? ` (campaign ${contact.campaign_id})` : ''}: ${contact.notes}`
                : `Lead from WolfGrid${contact.campaign_id ? ` campaign ${contact.campaign_id}` : ''}`,
              person,
            }),
          }),
          5000
        );

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`FUB ${res.status}: ${text.slice(0, 200)}`);
        }

        await supabase
          .from('crm_connections')
          .update({ last_push_at: new Date().toISOString(), status: 'connected', last_error: null })
          .eq('workspace_id', workspaceId)
          .in('provider', ['followupboss', 'fub']);

        return { provider: 'followupboss', displayName: 'Follow Up Boss', status: 'synced', ms: Date.now() - start };
      } catch (err) {
        return {
          provider: 'followupboss', displayName: 'Follow Up Boss', status: 'failed',
          ms: Date.now() - start, error: err instanceof Error ? err.message : 'FUB push failed',
        };
      }
    });
  }

  // ── HubSpot ─────────────────────────────────────────────────────────────────
  if (hasHubSpot) {
    tasks.push(async () => {
      const start = Date.now();
      try {
        const hubAuth = await getHubSpotAuthForUserWorkspace(supabase, userId);
        if (!hubAuth) return { provider: 'hubspot', displayName: 'HubSpot', status: 'skipped' };

        const token = hubAuth.headers.Authorization.replace('Bearer ', '');
        let existingId = await findExistingRemoteId(supabase, userId, contact.id, 'hubspot');
        if (!existingId && contact.email) existingId = await hubSpotClient.findContactByEmail(token, contact.email);
        if (!existingId && contact.phone) existingId = await hubSpotClient.findContactByPhone(token, contact.phone);

        const leadPayload = {
          id: contact.id, name: contact.full_name, phone: contact.phone,
          email: contact.email, address: contact.address, notes: contact.notes, source: 'WolfGrid',
        };
        const result = existingId
          ? await withTimeout(hubSpotClient.updateContact(token, existingId, leadPayload), 5000)
          : await withTimeout(hubSpotClient.createContact(token, leadPayload), 5000);

        if (contact.notes) {
          try { await hubSpotClient.createNote(token, result.contactId, contact.notes); } catch { /* non-fatal */ }
        }

        await upsertRemoteLink(supabase, userId, contact.id, 'hubspot', result.contactId, 'contact', { provider: 'hubspot' });
        await supabase
          .from('crm_connections')
          .update({ last_push_at: new Date().toISOString(), status: 'connected', last_error: null })
          .eq('workspace_id', workspaceId)
          .eq('provider', 'hubspot');

        return { provider: 'hubspot', displayName: 'HubSpot', status: 'synced', ms: Date.now() - start };
      } catch (err) {
        return {
          provider: 'hubspot', displayName: 'HubSpot', status: 'failed',
          ms: Date.now() - start, error: err instanceof Error ? err.message : 'HubSpot push failed',
        };
      }
    });
  }

  // ── BoldTrail / kvCORE ───────────────────────────────────────────────────────
  if (hasBoldTrail) {
    tasks.push(async () => {
      const start = Date.now();
      try {
        const token = await getBoldTrailTokenForWorkspace(supabase, workspaceId);
        if (!token) return { provider: 'boldtrail', displayName: 'BoldTrail / kvCORE', status: 'skipped' };

        const contactPayload = {
          id: contact.id, name: contact.full_name, phone: contact.phone,
          email: contact.email, address: contact.address, source: 'WolfGrid', notes: contact.notes,
        };

        const existingId = await findExistingRemoteId(supabase, userId, contact.id, 'boldtrail');
        let remoteId = existingId;

        if (existingId) {
          await boldTrailClient.updateContact(token, existingId, contactPayload);
        } else {
          const created = await withTimeout(boldTrailClient.createContact(token, contactPayload), 5000);
          remoteId = created.contactId;
        }

        if (remoteId) {
          const note = buildBoldTrailFollowUpNote(contact.notes);
          if (note) { try { await boldTrailClient.addNote(token, remoteId, note); } catch { /* non-fatal */ } }
          await upsertRemoteLink(supabase, userId, contact.id, 'boldtrail', remoteId, 'contact', { provider: 'boldtrail' });
        }

        await supabase
          .from('crm_connections')
          .update({ last_push_at: new Date().toISOString(), status: 'connected', last_error: null })
          .eq('workspace_id', workspaceId)
          .eq('provider', 'boldtrail');

        return { provider: 'boldtrail', displayName: 'BoldTrail / kvCORE', status: 'synced', ms: Date.now() - start };
      } catch (err) {
        return {
          provider: 'boldtrail', displayName: 'BoldTrail / kvCORE', status: 'failed',
          ms: Date.now() - start, error: err instanceof Error ? err.message : 'BoldTrail push failed',
        };
      }
    });
  }

  // ── Zapier ───────────────────────────────────────────────────────────────────
  if (hasZapier) {
    tasks.push(async () => {
      const start = Date.now();
      try {
        const webhookUrl = await getZapierWebhookUrlForWorkspace(supabase, workspaceId);
        if (!webhookUrl) return { provider: 'zapier', displayName: 'Zapier', status: 'skipped' };

        await withTimeout(
          zapierClient.sendLead(webhookUrl, workspaceId, {
            id: contact.id, name: contact.full_name, email: contact.email,
            phone: contact.phone, address: contact.address, notes: contact.notes,
            source: 'WolfGrid', campaignId: contact.campaign_id,
          }),
          5000
        );

        await supabase
          .from('crm_connections')
          .update({ last_push_at: new Date().toISOString(), status: 'connected', last_error: null })
          .eq('workspace_id', workspaceId)
          .eq('provider', 'zapier');

        return { provider: 'zapier', displayName: 'Zapier', status: 'synced', ms: Date.now() - start };
      } catch (err) {
        return {
          provider: 'zapier', displayName: 'Zapier', status: 'failed',
          ms: Date.now() - start, error: err instanceof Error ? err.message : 'Zapier push failed',
        };
      }
    });
  }

  // ── Monday.com ───────────────────────────────────────────────────────────────
  if (hasMonday && mondayRow) {
    tasks.push(async () => {
      const start = Date.now();
      try {
        const accessToken = String(mondayRow.access_token);
        const boardId = String(mondayRow.selected_board_id);
        const boardName = mondayRow.selected_board_name ? String(mondayRow.selected_board_name) : 'WolfGrid Leads';

        const boards = await fetchMondayBoards(accessToken);
        const board = boards.find((b) => b.id === boardId);
        if (!board) throw new Error('Selected Monday board not found');

        await validateMondayBoardSelection(accessToken, board.id);
        const providerConfig = mondayRow.provider_config as { columnMapping?: Record<string, MondayColumnMappingEntry> } | null;
        const mapping = resolveMondayColumnMapping(board.columns, providerConfig?.columnMapping ?? null);

        const itemName = contact.full_name?.trim() || contact.email?.trim() || contact.phone?.trim() || 'WolfGrid Lead';
        const columnValues = buildMondayColumnValues(
          { phone: contact.phone, email: contact.email, address: contact.address, notes: contact.notes },
          board.columns,
          mapping
        );

        const existingItemId = await findExistingRemoteId(supabase, userId, contact.id, 'monday');
        let mondayItemId: string;

        if (existingItemId) {
          await withTimeout(updateMondayItem(accessToken, board.id, existingItemId, columnValues), 5000);
          mondayItemId = existingItemId;
        } else {
          mondayItemId = await withTimeout(createMondayItem(accessToken, board.id, itemName, columnValues), 5000);
        }

        if (contact.notes?.trim() && mapping.notes?.strategy === 'update_comment') {
          try { await createMondayUpdate(accessToken, mondayItemId, contact.notes.trim()); } catch { /* non-fatal */ }
        }

        await upsertRemoteLink(supabase, userId, contact.id, 'monday', mondayItemId, 'item', { boardId, boardName });

        return { provider: 'monday', displayName: 'Monday.com', status: 'synced', ms: Date.now() - start };
      } catch (err) {
        return {
          provider: 'monday', displayName: 'Monday.com', status: 'failed',
          ms: Date.now() - start, error: err instanceof Error ? err.message : 'Monday push failed',
        };
      }
    });
  }

  // ── Contractor integrations ───────────────────────────────────────────────────
  for (const provider of contractorProviders) {
    const p = provider;
    tasks.push(async () => {
      const start = Date.now();
      const displayName = getContractorDisplayName(p);
      try {
        const auth = await getContractorAuthForWorkspace(supabase, userId, workspaceId, p);
        if (!auth) return { provider: p, displayName, status: 'skipped' };

        // Skip if already pushed — contractor providers are insert-only
        const existingId = await findExistingRemoteId(supabase, userId, contact.id, p);
        if (existingId) return { provider: p, displayName, status: 'synced', ms: 0 };

        const result = await withTimeout(
          pushContractorLead(p, auth, {
            id: contact.id, name: contact.full_name, email: contact.email,
            phone: contact.phone, address: contact.address, notes: contact.notes,
            source: 'WolfGrid', campaignId: contact.campaign_id,
          }),
          5000
        );

        await upsertRemoteLink(supabase, userId, contact.id, p, result.remoteObjectId, result.remoteObjectType, { provider: p });
        await supabase
          .from('crm_connections')
          .update({ last_push_at: new Date().toISOString(), status: 'connected', last_error: null })
          .eq('workspace_id', workspaceId)
          .eq('provider', p);

        return { provider: p, displayName, status: 'synced', ms: Date.now() - start };
      } catch (err) {
        return {
          provider: p, displayName, status: 'failed',
          ms: Date.now() - start, error: err instanceof Error ? err.message : `${displayName} push failed`,
        };
      }
    });
  }

  if (tasks.length === 0) return [];

  const settled = await Promise.allSettled(tasks.map((fn) => fn()));
  return settled.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { provider: 'unknown', displayName: 'Unknown', status: 'failed' as const, error: String(r.reason) }
  );
}

/**
 * Format the first successful sync result into a UI label.
 * e.g. "Synced → HubSpot · 0.4s"
 */
export function formatCrmSyncLabel(results: CrmPushResult[]): string | null {
  const synced = results.filter((r) => r.status === 'synced');
  if (synced.length === 0) return null;
  if (synced.length === 1) {
    const r = synced[0];
    return `Synced → ${r.displayName}${r.ms != null ? ` · ${(r.ms / 1000).toFixed(1)}s` : ''}`;
  }
  return `Synced → ${synced.map((r) => r.displayName).join(', ')}`;
}
