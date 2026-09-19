import * as turf from '@turf/turf';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import { planGeometryTargets, type ExistingTargetAddress } from './CampaignGeometryTargets';
import type { StandardCampaignAddress } from './AddressAdapter';
import { MAX_CAMPAIGN_HOMES } from './campaignHomeLimits';
import { configuredMaxReverseGeocodes, configuredReverseGeocodingStorageMode, parseMapboxReverseResult } from './CampaignMapReconciliationService';
import { mapWithConcurrency, interiorCentroid } from './ParcelPinPlacement';

export type EnrichmentTarget = {
  id: string; campaign_id: string; region: string;
  geometry_target_geom: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  address_resolution_lease: string;
  address_resolution_permanent_allowed: boolean;
};
export function safeGeometryAddress(target: EnrichmentTarget, result: ReturnType<typeof parseMapboxReverseResult>): boolean {
  if (!result || !['rooftop', 'parcel'].includes(result.accuracy)) return false;
  const regionMatches = result.region?.toUpperCase() === target.region.toUpperCase();
  const countryMatches = ['NZ', 'GB', 'AU', 'ZA'].includes(target.region.toUpperCase()) &&
    result.country?.toUpperCase() === target.region.toUpperCase();
  if (!regionMatches && !countryMatches) return false;
  try { return turf.booleanPointInPolygon([result.longitude, result.latitude], target.geometry_target_geom); }
  catch { return false; }
}

export class CampaignAddressEnrichmentService {
  constructor(private readonly supabase: SupabaseClient) {}

  async ensureTargets(input: {
    campaignId: string; region: string; source: StandardCampaignAddress['source'];
    boundary: GeoJSON.Polygon; buildings: GeoJSON.Feature[]; parcels: GeoJSON.Feature[];
  }): Promise<{ added: number; discovered: number; geometryTargets: number }> {
    const existing = await fetchAllInPages<ExistingTargetAddress & { address_resolution_permanent_allowed?: boolean }>(async (from, to) => await this.supabase
      .from('campaign_addresses').select('id,coordinate,gers_id,building_gers_id,address_resolution_permanent_allowed')
      .eq('campaign_id', input.campaignId).range(from, to));
    // Preserve the broader building fallback only for territories that began
    // without source coverage. Parcel targets are independently eligible below
    // because the planner emits them only for uncovered eligible properties.
    const zeroSourceCoverage = existing.length === 0 || existing.every(row =>
      row.gers_id?.startsWith('synthetic:geometry-target:') && row.address_resolution_permanent_allowed === true);
    const candidates = planGeometryTargets({ ...input, existing, limit: MAX_CAMPAIGN_HOMES + 1 });
    const targets = candidates.slice(0, Math.max(0, MAX_CAMPAIGN_HOMES - existing.length));
    for (let offset = 0; offset < targets.length; offset += 250) {
      const rows = targets.slice(offset, offset + 250).map(t => {
        const confirmed = Boolean(t.houseNumber && t.streetName);
        const permanentAllowed = !confirmed && (t.kind === 'parcel' || zeroSourceCoverage);
        const formatted = confirmed ? `${t.houseNumber} ${t.streetName}` : 'Address pending';
        return {
          campaign_id: input.campaignId, gers_id: t.key, source_id: t.key, source: input.source,
          formatted, address: formatted, region: input.region,
          house_number: confirmed ? t.houseNumber : null, street_name: confirmed ? t.streetName : null,
          locality: t.locality, postal_code: t.postalCode,
          coordinate: { lon: t.coordinate[0], lat: t.coordinate[1] },
          geom: JSON.stringify({ type: 'Point', coordinates: t.coordinate }),
          building_gers_id: t.kind === 'building' ? t.geometryId : null,
          geometry_target_kind: t.kind, geometry_target_id: t.geometryId, geometry_target_geom: t.geometry,
          address_resolution_permanent_allowed: permanentAllowed,
          address_resolution_status: confirmed ? 'confirmed' : permanentAllowed ? 'pending' : 'unresolved',
          address_resolution_error: !confirmed && !permanentAllowed
            ? 'Paid enrichment requires an uncovered parcel or a campaign with zero source coverage'
            : null,
        };
      });
      const { error } = await this.supabase.from('campaign_addresses')
        .upsert(rows, { onConflict: 'campaign_id,gers_id', ignoreDuplicates: true });
      if (error) throw new Error(`Failed to save geometry stops: ${error.message}`);
    }
    return { added: targets.length, discovered: existing.length + candidates.length,
      geometryTargets: targets.length + existing.filter(row => row.gers_id?.startsWith('synthetic:geometry-target:')).length };
  }

  async processBatch(): Promise<{ claimed: number; confirmed: number; campaignId: string | null; skipped?: string }> {
    const token = process.env.MAPBOX_TOKEN?.trim() || process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
    // Separate mode avoids enabling paid calls in the existing broad optimizer.
    const permanent = configuredReverseGeocodingStorageMode(process.env.MAP_GEOMETRY_ENRICHMENT_STORAGE_MODE ?? process.env.MAPBOX_GEOCODING_STORAGE_MODE) === 'permanent';
    if (process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE !== 'true' || !token ||
        !permanent || configuredMaxReverseGeocodes() === 0) {
      return { claimed: 0, confirmed: 0, campaignId: null, skipped: 'Permanent reverse geocoding is not configured' };
    }
    const { data, error } = await this.supabase.rpc('claim_campaign_address_enrichment', { p_limit: Math.min(24, configuredMaxReverseGeocodes()) });
    if (error) throw new Error(`Cannot claim address enrichment: ${error.message}`);
    const rows = (data ?? []) as EnrichmentTarget[];
    const results = await mapWithConcurrency(rows, 6, async target => {
      let result: ReturnType<typeof parseMapboxReverseResult> = null;
      let failure: string | null = null;
      let retry = false;
      try {
        if (target.address_resolution_permanent_allowed !== true) throw new Error('Target is not eligible for paid enrichment');
        const [longitude, latitude] = interiorCentroid(turf.feature(target.geometry_target_geom));
        const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
        for (const [key, value] of Object.entries({ longitude, latitude, types: 'address', limit: 1, permanent, access_token: token })) url.searchParams.set(key, String(value));
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
          retry = response.status === 429 || response.status >= 500;
          failure = `Address provider returned ${response.status}`;
        } else {
          const candidate = parseMapboxReverseResult(target.id, await response.json());
          if (safeGeometryAddress(target, candidate)) result = candidate;
        }
      } catch {
        retry = true;
        failure = 'Address provider or geometry lookup failed';
      }
      const { data: applied, error: finishError } = await this.supabase.rpc('finish_campaign_address_enrichment', {
        p_address_id: target.id, p_lease: target.address_resolution_lease,
        p_result: result ? {
          formatted: `${result.houseNumber} ${result.streetName}${result.locality ? `, ${result.locality}` : ''}`,
          house_number: result.houseNumber, street_name: result.streetName,
          locality: result.locality, postal_code: result.postalCode, region: result.region, country: result.country,
          longitude: result.longitude, latitude: result.latitude, accuracy: result.accuracy,
        } : null,
        p_error: failure, p_retry: retry,
      });
      if (finishError) throw new Error(`Cannot save enriched address: ${finishError.message}`);
      return applied === true;
    });
    return { claimed: rows.length, confirmed: results.filter(Boolean).length, campaignId: rows[0]?.campaign_id ?? null };
  }
}
