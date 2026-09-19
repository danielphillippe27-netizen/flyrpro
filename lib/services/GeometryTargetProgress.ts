import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';

export type GeometryTargetState = {
  id: string; geometry_target_kind: string; geometry_target_id: string;
  address_resolution_status: string; formatted: string;
  house_number: string | null; street_name: string | null;
};
export async function fetchGeometryTargetStates(supabase: SupabaseClient, campaignId: string): Promise<GeometryTargetState[]> {
  const rows = await fetchAllInPages<GeometryTargetState>(async (from, to) => await supabase.from('campaign_addresses')
    .select('id,geometry_target_kind,geometry_target_id,address_resolution_status,formatted,house_number,street_name')
    .eq('campaign_id', campaignId).not('geometry_target_kind', 'is', null).is('deleted_at', null)
    .order('id').range(from, to));
  return rows;
}
export function geometryEnrichmentEnabled(): boolean {
  const rawLimit = process.env.MAP_RECONCILIATION_MAX_GEOCODES_PER_RUN?.trim();
  const parsedLimit = rawLimit ? Number(rawLimit) : 1000;
  const limit = Number.isFinite(parsedLimit) ? Math.max(0, Math.floor(parsedLimit)) : 1000;
  return process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE === 'true' &&
    Boolean(process.env.MAPBOX_TOKEN?.trim() || process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()) &&
    (process.env.MAP_GEOMETRY_ENRICHMENT_STORAGE_MODE ?? process.env.MAPBOX_GEOCODING_STORAGE_MODE)?.trim().toLowerCase() === 'permanent' &&
    limit > 0;
}

/** The legacy run_id is also the clients' report/adoption cache key. When
 * enrichment participates, expose a presentation revision and retain the real
 * optimizer job ID separately; this revision is never used for DB mutations. */
export function mergeGeometryTargetProgress<T extends {
  status: string; run_id?: string; report?: Record<string, unknown>; applied_bundle_signature?: string | null;
}>(base: T, rows: GeometryTargetState[], enabled = geometryEnrichmentEnabled()) {
  if (!rows.length) return base;
  const pending = rows.filter(row => row.address_resolution_status === 'pending').length;
  const unresolved = rows.filter(row => row.address_resolution_status === 'unresolved').length;
  const active = ['queued', 'matching', 'geocoding', 'applying'].includes(base.status);
  const status = base.status === 'failed' ? 'failed' : active ? base.status :
    pending && enabled ? 'geocoding' :
    unresolved || pending || base.status === 'review_needed' ? 'review_needed' : 'completed';
  const revision = createHash('sha256').update(JSON.stringify({
    run: base.run_id ?? null,
    rows: [...rows].sort((a,b) => a.id.localeCompare(b.id)),
  })).digest('hex');
  return {
    ...base, status: status as T['status'],
    run_id: `address-enrichment:${revision}`,
    reconciliation_run_id: base.run_id,
    applied_bundle_signature: null,
    report: { ...base.report,
      pending_addresses: pending, unresolved_addresses: unresolved,
      review_needed: Number(base.report?.review_needed ?? 0) + unresolved + (enabled ? 0 : pending),
    },
    address_enrichment: { pending, unresolved, confirmed: rows.length - pending - unresolved,
      status: pending ? enabled ? 'running' : 'needs_configuration' : unresolved ? 'review_needed' : 'completed' },
  };
}
