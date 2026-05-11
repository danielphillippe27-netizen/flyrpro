import { createAdminClient } from '@/lib/supabase/server';
import { decryptMetaAccessToken } from './oauth';
import { listCampaignDailyInsights, metaErrorResponse } from './client';

type AdminClient = ReturnType<typeof createAdminClient>;

type MetaConnectionForSync = {
  id: string;
  user_id: string;
  access_token_encrypted: string;
  token_expires_at?: string | null;
};

type MetaCampaignLinkForSync = {
  id: string;
  farm_id: string;
  user_id: string;
  team_id?: string | null;
  meta_connection_id: string | null;
  meta_campaign_id: string;
  meta_campaign_name?: string | null;
};

export type MetaCampaignSyncResult = {
  linkId: string;
  farmId: string;
  metaCampaignId: string;
  ok: boolean;
  rowsSynced: number;
  error?: string;
};

export type MetaSyncRunResult = {
  syncedFrom: string;
  syncedTo: string;
  linksFound: number;
  rowsSynced: number;
  results: MetaCampaignSyncResult[];
};

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function getLastSevenDayWindow(now = new Date()): { since: string; until: string } {
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 6);
  return {
    since: formatDate(since),
    until: formatDate(until),
  };
}

function parseInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDecimal(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveLeads(actions: Array<{ action_type?: string; value?: string }> | undefined): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, action) => {
    const type = action.action_type?.toLowerCase() || '';
    return type.includes('lead') ? sum + parseInteger(action.value) : sum;
  }, 0);
}

async function logMetaSync(
  admin: AdminClient,
  payload: {
    link?: MetaCampaignLinkForSync;
    status: 'success' | 'error';
    message?: string | null;
    errorCode?: string | null;
    syncedFrom: string;
    syncedTo: string;
    rowsSynced?: number;
  }
) {
  await admin.from('meta_sync_logs').insert({
    farm_id: payload.link?.farm_id ?? null,
    farm_meta_campaign_link_id: payload.link?.id ?? null,
    meta_campaign_id: payload.link?.meta_campaign_id ?? null,
    user_id: payload.link?.user_id ?? null,
    team_id: payload.link?.team_id ?? null,
    status: payload.status,
    message: payload.message ?? null,
    error_code: payload.errorCode ?? null,
    synced_from: payload.syncedFrom,
    synced_to: payload.syncedTo,
    rows_synced: payload.rowsSynced ?? 0,
  });
}

async function loadConnectionsById(
  admin: AdminClient,
  connectionIds: string[]
): Promise<Map<string, MetaConnectionForSync>> {
  if (connectionIds.length === 0) return new Map();

  const { data, error } = await admin
    .from('meta_connections')
    .select('id, user_id, access_token_encrypted, token_expires_at')
    .in('id', connectionIds);

  if (error) throw new Error(error.message);

  return new Map(
    ((data ?? []) as MetaConnectionForSync[]).map((connection) => [connection.id, connection])
  );
}

export async function syncMetaCampaignLinkMetrics(
  admin: AdminClient,
  link: MetaCampaignLinkForSync,
  connection: MetaConnectionForSync,
  window: { since: string; until: string }
): Promise<MetaCampaignSyncResult> {
  try {
    if (connection.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now()) {
      throw new Error('Meta permissions expired or were revoked. Reconnect Meta Ads.');
    }

    const accessToken = decryptMetaAccessToken(connection.access_token_encrypted);
    const insights = await listCampaignDailyInsights(accessToken, link.meta_campaign_id, window);
    const now = new Date().toISOString();
    const rows = insights
      .map((insight) => {
        const date = insight.date_start || insight.date_stop;
        if (!date) return null;
        return {
          farm_id: link.farm_id,
          farm_meta_campaign_link_id: link.id,
          meta_campaign_id: link.meta_campaign_id,
          date,
          spend: parseDecimal(insight.spend),
          impressions: parseInteger(insight.impressions),
          reach: parseInteger(insight.reach),
          clicks: parseInteger(insight.clicks),
          leads: deriveLeads(insight.actions),
          actions: insight.actions ?? null,
          raw_payload: insight,
          updated_at: now,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    if (rows.length > 0) {
      const { error } = await admin
        .from('farm_meta_ad_daily_metrics')
        .upsert(rows, { onConflict: 'farm_meta_campaign_link_id,date' });
      if (error) throw new Error(error.message);
    }

    const { error: linkUpdateError } = await admin
      .from('farm_meta_campaign_links')
      .update({ last_synced_at: now, updated_at: now })
      .eq('id', link.id);
    if (linkUpdateError) throw new Error(linkUpdateError.message);

    await logMetaSync(admin, {
      link,
      status: 'success',
      message: 'Meta campaign metrics synced.',
      syncedFrom: window.since,
      syncedTo: window.until,
      rowsSynced: rows.length,
    });

    return {
      linkId: link.id,
      farmId: link.farm_id,
      metaCampaignId: link.meta_campaign_id,
      ok: true,
      rowsSynced: rows.length,
    };
  } catch (error) {
    const metaError = metaErrorResponse(error);
    await logMetaSync(admin, {
      link,
      status: 'error',
      message: metaError.message,
      errorCode: metaError.code,
      syncedFrom: window.since,
      syncedTo: window.until,
    });

    return {
      linkId: link.id,
      farmId: link.farm_id,
      metaCampaignId: link.meta_campaign_id,
      ok: false,
      rowsSynced: 0,
      error: metaError.message,
    };
  }
}

export async function syncMetaCampaignLinks(
  admin: AdminClient,
  links: MetaCampaignLinkForSync[],
  window = getLastSevenDayWindow()
): Promise<MetaSyncRunResult> {
  const connectionIds = Array.from(
    new Set(links.map((link) => link.meta_connection_id).filter((value): value is string => Boolean(value)))
  );
  const connections = await loadConnectionsById(admin, connectionIds);
  const results: MetaCampaignSyncResult[] = [];

  for (const link of links) {
    const connection = link.meta_connection_id ? connections.get(link.meta_connection_id) : null;
    if (!connection) {
      await logMetaSync(admin, {
        link,
        status: 'error',
        message: 'Meta connection missing. Reconnect Meta Ads.',
        errorCode: 'not_connected',
        syncedFrom: window.since,
        syncedTo: window.until,
      });
      results.push({
        linkId: link.id,
        farmId: link.farm_id,
        metaCampaignId: link.meta_campaign_id,
        ok: false,
        rowsSynced: 0,
        error: 'Meta connection missing. Reconnect Meta Ads.',
      });
      continue;
    }

    results.push(await syncMetaCampaignLinkMetrics(admin, link, connection, window));
  }

  return {
    syncedFrom: window.since,
    syncedTo: window.until,
    linksFound: links.length,
    rowsSynced: results.reduce((sum, result) => sum + result.rowsSynced, 0),
    results,
  };
}

export async function syncAllLinkedMetaCampaignsDaily(
  admin = createAdminClient(),
  window = getLastSevenDayWindow()
): Promise<MetaSyncRunResult> {
  const { data, error } = await admin
    .from('farm_meta_campaign_links')
    .select('id, farm_id, user_id, team_id, meta_connection_id, meta_campaign_id, meta_campaign_name')
    .eq('status', 'active');

  if (error) throw new Error(error.message);

  // TODO(vercel-cron): call this service from a daily Vercel Cron route once scheduling is enabled.
  // TODO(supabase-edge-function): alternatively call this from a Supabase Edge Function if DB-side scheduling becomes preferred.
  // TODO(meta-lead-ads): add Meta Lead Form import after analytics sync is stable and leads_retrieval is approved.
  return syncMetaCampaignLinks(admin, (data ?? []) as MetaCampaignLinkForSync[], window);
}
