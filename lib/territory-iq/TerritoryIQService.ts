import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as turf from '@turf/turf';
import {
  GRID_SCORE_MODEL_VERSION,
  clampScore,
  confidenceLabel,
  homeAgeOpportunityScore,
  profileForIndustry,
  scoreFactors,
  type TerritoryIQProfile,
} from './scoring';
import type {
  TerritoryIQCellProperties,
  TerritoryIQFactor,
  TerritoryIQFactorKey,
  TerritoryIQResponse,
  TerritoryIQSource,
} from './types';

type JsonRecord = Record<string, unknown>;
type AddressRow = {
  id: string;
  coordinate?: { lat?: number; lon?: number } | null;
  geom?: unknown;
  distance_m?: number | null;
};
type CampaignRow = {
  id: string;
  workspace_id: string;
  territory_boundary?: GeoJSON.Polygon | null;
  region?: string | null;
  updated_at?: string | null;
  map_ready_at?: string | null;
};
type CensusProperties = {
  dguid?: string;
  name?: string;
  province_code?: string;
  market_key?: string;
  median_household_income?: number;
  owner_occupied_pct?: number;
  detached_fit_pct?: number;
  construction_periods?: Record<string, number>;
  income_percentile?: number;
  owner_percentile?: number;
  detached_percentile?: number;
  source_version?: string;
  source_release_date?: string;
  source_provider?: string;
};
type PermitRecord = {
  permit_category?: string;
  service_category?: string;
  status?: string;
  issued_at?: string;
  completed_at?: string;
  confidence?: number;
  longitude?: number;
  latitude?: number;
};
type WeatherRecord = {
  event_type?: string;
  occurred_at?: string;
  severity?: number;
  confidence?: number;
  geometry?: GeoJSON.Geometry;
};
type ScoreRunRow = {
  id: string;
  campaign_id: string;
  requested_by?: string | null;
};

const FACTOR_LABELS: Record<TerritoryIQFactorKey, string> = {
  home_age_opportunity: 'Home age opportunity',
  detached_home_fit: 'Detached-home fit',
  owner_occupancy: 'Owner occupancy',
  household_income: 'Household income',
  canvassability: 'Canvassability',
  permit_activity: 'Permit activity',
  storm_exposure: 'Storm exposure',
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function pointFromAddress(address: AddressRow): GeoJSON.Feature<GeoJSON.Point> | null {
  const longitude = asNumber(address.coordinate?.lon);
  const latitude = asNumber(address.coordinate?.lat);
  if (longitude !== null && latitude !== null) {
    return turf.point([longitude, latitude]);
  }
  const geom = asRecord(address.geom);
  if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
    const lon = asNumber(geom.coordinates[0]);
    const lat = asNumber(geom.coordinates[1]);
    if (lon !== null && lat !== null) return turf.point([lon, lat]);
  }
  return null;
}

function featureCollection(value: unknown): GeoJSON.FeatureCollection {
  const record = asRecord(value);
  return {
    type: 'FeatureCollection',
    features: Array.isArray(record.features) ? record.features as GeoJSON.Feature[] : [],
  };
}

function containsPoint(feature: GeoJSON.Feature, point: GeoJSON.Feature<GeoJSON.Point>): boolean {
  if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) return false;
  return turf.booleanPointInPolygon(point, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function estimatedAgeFromConstructionPeriods(periods: Record<string, number> | undefined): number | null {
  if (!periods) return null;
  const currentYear = 2026;
  const midpointByKey: Record<string, number> = {
    '1960_or_before': 1950,
    '1961_1980': 1970,
    '1981_1990': 1985,
    '1991_2000': 1995,
    '2001_2005': 2003,
    '2006_2010': 2008,
    '2011_2015': 2013,
    '2016_2021': 2019,
  };
  let total = 0;
  let weighted = 0;
  for (const [key, countValue] of Object.entries(periods)) {
    const count = asNumber(countValue);
    const year = midpointByKey[key];
    if (count === null || !year) continue;
    total += count;
    weighted += count * (currentYear - year);
  }
  return total > 0 ? weighted / total : null;
}

function buildingYear(feature: GeoJSON.Feature): number | null {
  const properties = asRecord(feature.properties);
  const year = asNumber(properties.year_built ?? properties.yearBuilt ?? properties.construction_year);
  return year !== null && year >= 1800 && year <= 2026 ? year : null;
}

function buildingDetachedFit(feature: GeoJSON.Feature): number | null {
  const properties = asRecord(feature.properties);
  const value = String(
    properties.building_type ?? properties.subtype ?? properties.class ?? properties.type ?? ''
  ).toLowerCase();
  if (!value) return null;
  if (value.includes('semi')) return 80;
  if (value.includes('row') || value.includes('town')) return 60;
  if (value.includes('apartment') || value.includes('multi')) return 10;
  if (value.includes('detached') || value.includes('house') || value.includes('residential')) return 100;
  return null;
}

function factor(
  key: TerritoryIQFactorKey,
  score: number | null,
  confidence: number,
  rawValue: number | null,
  rawUnit: string | null,
  source: string | null,
  areaEstimate = false
): Omit<TerritoryIQFactor, 'configuredWeight' | 'effectiveWeight' | 'contribution'> {
  return {
    key,
    label: FACTOR_LABELS[key],
    rawValue,
    rawUnit,
    score: score === null ? null : clampScore(score),
    confidence,
    available: score !== null,
    source,
    areaEstimate,
  };
}

function serviceMatchesProfile(profile: TerritoryIQProfile, value: string): boolean {
  const normalized = value.toLowerCase();
  if (profile.key === 'roofing') return normalized.includes('roof') || normalized.includes('exterior');
  if (profile.key === 'solar') return normalized.includes('solar');
  if (profile.key === 'hvac') return normalized.includes('hvac') || normalized.includes('heating');
  if (profile.key === 'pest_control') return normalized.includes('pest');
  return false;
}

function permitFactor(
  profile: TerritoryIQProfile,
  permits: PermitRecord[],
  cell: GeoJSON.Feature
): ReturnType<typeof factor> {
  const nearby = permits.filter((permit) => {
    const lon = asNumber(permit.longitude);
    const lat = asNumber(permit.latitude);
    return lon !== null && lat !== null && containsPoint(cell, turf.point([lon, lat]));
  });
  if (!nearby.length) return factor('permit_activity', null, 0, null, 'permits', null);
  const sameService = nearby.filter((permit) =>
    serviceMatchesProfile(profile, `${permit.service_category ?? ''} ${permit.permit_category ?? ''}`)
  ).length;
  const general = Math.min(100, nearby.length * 25);
  const score = Math.max(0, general - sameService * 35);
  const permitConfidence = average(nearby.map((permit) => asNumber(permit.confidence) ?? 0.5)) ?? 0.5;
  return factor(
    'permit_activity',
    score,
    Math.min(0.8, permitConfidence),
    nearby.length,
    'recent permits',
    'Municipal permit pilot'
  );
}

function stormFactor(
  weather: WeatherRecord[],
  cell: GeoJSON.Feature,
  now: Date
): ReturnType<typeof factor> {
  const relevant = weather.filter((event) => {
    if (!event.geometry) return false;
    const eventFeature = turf.feature(event.geometry);
    if (event.geometry.type === 'Point') return containsPoint(cell, eventFeature as GeoJSON.Feature<GeoJSON.Point>);
    try {
      return turf.booleanIntersects(
        cell as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
        eventFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      );
    } catch {
      return false;
    }
  });
  if (!relevant.length) return factor('storm_exposure', null, 0, null, 'events', null);
  const halfLifeDays = 18 * 30.4375;
  const exposure = relevant.reduce((sum, event) => {
    const occurredAt = Date.parse(event.occurred_at ?? '');
    if (!Number.isFinite(occurredAt)) return sum;
    const ageDays = Math.max(0, (now.getTime() - occurredAt) / 86_400_000);
    const decay = Math.pow(0.5, ageDays / halfLifeDays);
    return sum + (asNumber(event.severity) ?? 0) * (asNumber(event.confidence) ?? 0.5) * decay;
  }, 0);
  return factor(
    'storm_exposure',
    Math.min(100, exposure * 100),
    Math.min(0.85, average(relevant.map((event) => asNumber(event.confidence) ?? 0.5)) ?? 0.5),
    relevant.length,
    'verified events',
    'Verified hail/wind pilot'
  );
}

function geometryToEwkt(geometry: GeoJSON.Geometry): string {
  const ring = (points: GeoJSON.Position[]) =>
    `(${points.map((point) => `${point[0]} ${point[1]}`).join(',')})`;
  if (geometry.type === 'Polygon') {
    return `SRID=4326;POLYGON(${geometry.coordinates.map(ring).join(',')})`;
  }
  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates.map(
      (polygon) => `(${polygon.map(ring).join(',')})`
    );
    return `SRID=4326;MULTIPOLYGON(${polygons.join(',')})`;
  }
  throw new Error(`Unsupported cell geometry ${geometry.type}`);
}

function aggregateFactors(cells: Array<GeoJSON.Feature<GeoJSON.Geometry, TerritoryIQCellProperties>>): TerritoryIQFactor[] {
  const totalHomes = cells.reduce((sum, cell) => sum + cell.properties.targetHomeCount, 0);
  const keys = Object.keys(FACTOR_LABELS) as TerritoryIQFactorKey[];
  return keys.map((key) => {
    const examples = cells
      .map((cell) => ({
        factor: cell.properties.factors.find((candidate) => candidate.key === key),
        homes: cell.properties.targetHomeCount,
      }))
      .filter((entry): entry is { factor: TerritoryIQFactor; homes: number } => Boolean(entry.factor));
    const first = examples[0]?.factor;
    if (!first || totalHomes === 0) {
      return {
        ...factor(key, null, 0, null, null, null),
        configuredWeight: 0,
        effectiveWeight: 0,
        contribution: 0,
      };
    }
    const weighted = (selector: (candidate: TerritoryIQFactor) => number) =>
      examples.reduce((sum, entry) => sum + selector(entry.factor) * entry.homes, 0) / totalHomes;
    const rawEntries = examples.filter((entry) => entry.factor.rawValue !== null);
    return {
      ...first,
      rawValue: rawEntries.length
        ? rawEntries.reduce((sum, entry) => sum + Number(entry.factor.rawValue) * entry.homes, 0) /
          rawEntries.reduce((sum, entry) => sum + entry.homes, 0)
        : null,
      score: examples.some((entry) => entry.factor.score !== null)
        ? weighted((candidate) => candidate.score ?? 0)
        : null,
      confidence: weighted((candidate) => candidate.confidence),
      effectiveWeight: weighted((candidate) => candidate.effectiveWeight),
      contribution: weighted((candidate) => candidate.contribution),
    };
  });
}

export class TerritoryIQService {
  constructor(private readonly supabase: SupabaseClient) {}

  async enqueue(campaignId: string, requestedBy: string | null = null): Promise<{ status: 'queued'; runId: string }> {
    const { data: campaign, error } = await this.supabase
      .from('campaigns')
      .select('id, workspace_id')
      .eq('id', campaignId)
      .single();
    if (error || !campaign?.workspace_id) throw new Error(error?.message ?? 'Campaign not found');
    const bucket = Math.floor(Date.now() / 60_000);
    const inputHash = stableHash([campaignId, GRID_SCORE_MODEL_VERSION, bucket]);
    const { data: run, error: runError } = await this.supabase
      .from('territory_iq_score_runs')
      .upsert({
        campaign_id: campaignId,
        workspace_id: campaign.workspace_id,
        idempotency_key: `manual:${campaignId}:${GRID_SCORE_MODEL_VERSION}:${bucket}`,
        input_hash: inputHash,
        model_key: 'auto',
        model_version: GRID_SCORE_MODEL_VERSION,
        status: 'queued',
        requested_by: requestedBy,
        queued_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'idempotency_key' })
      .select('id')
      .single();
    if (runError || !run?.id) throw new Error(runError?.message ?? 'Could not queue GRID SCORE');
    return { status: 'queued', runId: run.id };
  }

  async claimAndProcess(workerId: string): Promise<ScoreRunRow | null> {
    const { data, error } = await this.supabase.rpc('claim_territory_iq_score_run', {
      p_worker_id: workerId,
      p_lease_seconds: 240,
    });
    if (error) throw new Error(error.message);
    const run = (Array.isArray(data) ? data[0] : null) as ScoreRunRow | null;
    if (!run) return null;
    try {
      await this.calculate(run.campaign_id, run.requested_by ?? null, new Date(), run.id);
      await this.supabase
        .from('territory_iq_score_runs')
        .update({
          status: 'completed',
          lease_owner: null,
          lease_expires_at: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id);
    } catch (processError) {
      await this.supabase
        .from('territory_iq_score_runs')
        .update({
          status: 'failed',
          error_message: processError instanceof Error ? processError.message : String(processError),
          lease_owner: null,
          lease_expires_at: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id);
      throw processError;
    }
    return run;
  }

  async calculate(
    campaignId: string,
    requestedBy: string | null = null,
    now = new Date(),
    claimedRunId: string | null = null
  ): Promise<TerritoryIQResponse> {
    const { data: campaignData, error: campaignError } = await this.supabase
      .from('campaigns')
      .select('id, workspace_id, territory_boundary, region, updated_at, map_ready_at')
      .eq('id', campaignId)
      .single();
    if (campaignError || !campaignData?.workspace_id) {
      throw new Error(campaignError?.message ?? 'Campaign not found');
    }
    const campaign = campaignData as CampaignRow;
    const { data: workspaceData } = await this.supabase
      .from('workspaces')
      .select('id, industry')
      .eq('id', campaign.workspace_id)
      .single();
    const profile = profileForIndustry((workspaceData as { industry?: string | null } | null)?.industry);

    const [addressesResult, bundleResult, censusResult, enrichmentsResult] = await Promise.all([
      this.supabase
        .from('campaign_addresses')
        .select('id, coordinate, geom, distance_m')
        .eq('campaign_id', campaignId),
      this.supabase
        .from('campaign_map_bundles')
        .select('asset_signature, source_version, buildings_geojson, roads_geojson, built_at')
        .eq('campaign_id', campaignId)
        .eq('is_current', true)
        .maybeSingle(),
      this.supabase.rpc('get_territory_iq_census_areas_for_campaign', { p_campaign_id: campaignId }),
      this.supabase.rpc('get_territory_iq_enrichments_for_campaign', { p_campaign_id: campaignId }),
    ]);
    if (addressesResult.error) throw new Error(addressesResult.error.message);
    const addresses = (addressesResult.data ?? []) as AddressRow[];
    const addressPoints = addresses
      .map((address) => ({ address, point: pointFromAddress(address) }))
      .filter((entry): entry is { address: AddressRow; point: GeoJSON.Feature<GeoJSON.Point> } => Boolean(entry.point));
    const boundary = campaign.territory_boundary
      ? turf.feature(campaign.territory_boundary)
      : addressPoints.length >= 3
        ? turf.convex(turf.featureCollection(addressPoints.map((entry) => entry.point)))
        : null;
    if (!boundary || addressPoints.length === 0) {
      return this.emptyResponse(profile, addresses.length);
    }

    const bundle = asRecord(bundleResult.data);
    const buildings = featureCollection(bundle.buildings_geojson).features;
    const censusAreas = featureCollection(censusResult.data).features as Array<
      GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, CensusProperties>
    >;
    const enrichments = asRecord(enrichmentsResult.data);
    const permits = Array.isArray(enrichments.permits) ? enrichments.permits as PermitRecord[] : [];
    const weather = Array.isArray(enrichments.weather) ? enrichments.weather as WeatherRecord[] : [];

    const bbox = turf.bbox(boundary);
    const hexes = turf.hexGrid(bbox, 0.25, { units: 'kilometers', mask: boundary });
    const candidateCells = hexes.features.length
      ? hexes.features
      : [turf.circle(turf.centroid(boundary), 0.14, { units: 'kilometers', steps: 6 })];
    const cells: Array<GeoJSON.Feature<GeoJSON.Geometry, TerritoryIQCellProperties>> = [];

    for (const hex of candidateCells) {
      const targets = addressPoints.filter((entry) => containsPoint(hex, entry.point));
      if (!targets.length) continue;
      const clipped = turf.intersect(
        turf.featureCollection([
          hex as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
          boundary as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
        ])
      ) ?? hex;
      const center = turf.centroid(clipped);
      const census = censusAreas.find((area) => containsPoint(area, center));
      const censusProperties = census?.properties ?? {};
      const cellBuildings = buildings.filter((building) => {
        if (!building.geometry) return false;
        try {
          return containsPoint(clipped, turf.centroid(building));
        } catch {
          return false;
        }
      });
      const buildingAges = cellBuildings
        .map(buildingYear)
        .filter((value): value is number => value !== null)
        .map((year) => 2026 - year);
      const censusAge = estimatedAgeFromConstructionPeriods(censusProperties.construction_periods);
      const avgAge = average(buildingAges) ?? censusAge;
      const ageConfidence = buildingAges.length
        ? Math.min(0.95, 0.65 + buildingAges.length / Math.max(1, cellBuildings.length) * 0.3)
        : censusAge !== null ? 0.68 : 0;
      const detachedValues = cellBuildings
        .map(buildingDetachedFit)
        .filter((value): value is number => value !== null);
      const detachedRaw = average(detachedValues) ?? asNumber(censusProperties.detached_fit_pct);
      const detachedScore = detachedValues.length
        ? detachedRaw
        : asNumber(censusProperties.detached_percentile) ?? detachedRaw;
      const cellAreaKm2 = Math.max(0.01, turf.area(clipped) / 1_000_000);
      const homesPerKm2 = targets.length / cellAreaKm2;
      const routeDistances = targets
        .map((entry) => asNumber(entry.address.distance_m))
        .filter((value): value is number => value !== null && value >= 0);
      const routeEfficiency = routeDistances.length
        ? clampScore(100 - (average(routeDistances) ?? 0) / 20)
        : null;
      const densityScore = clampScore(homesPerKm2 / 4);
      const canvassScore = routeEfficiency === null
        ? densityScore
        : densityScore * 0.7 + routeEfficiency * 0.3;
      const factorsInput = [
        factor(
          'home_age_opportunity',
          avgAge === null ? null : homeAgeOpportunityScore(profile.key, avgAge),
          ageConfidence,
          avgAge,
          'estimated years',
          buildingAges.length ? 'WolfGrid building records' : census ? 'Statistics Canada Census 2021' : null,
          !buildingAges.length && Boolean(census)
        ),
        factor(
          'detached_home_fit',
          detachedScore,
          detachedValues.length ? 0.9 : census ? 0.78 : 0,
          detachedRaw,
          '% fit',
          detachedValues.length ? 'WolfGrid building records' : census ? 'Statistics Canada Census 2021' : null,
          !detachedValues.length && Boolean(census)
        ),
        factor(
          'owner_occupancy',
          asNumber(censusProperties.owner_percentile),
          censusProperties.owner_percentile === undefined ? 0 : 0.8,
          asNumber(censusProperties.owner_occupied_pct),
          '% owner occupied',
          census ? 'Statistics Canada Census 2021' : null,
          Boolean(census)
        ),
        factor(
          'household_income',
          asNumber(censusProperties.income_percentile),
          censusProperties.income_percentile === undefined ? 0 : 0.8,
          asNumber(censusProperties.median_household_income),
          'CAD median',
          census ? 'Statistics Canada Census 2021' : null,
          Boolean(census)
        ),
        factor(
          'canvassability',
          canvassScore,
          routeDistances.length ? 0.95 : 0.82,
          homesPerKm2,
          'target homes / km²',
          routeDistances.length ? 'WolfGrid campaign routes' : 'WolfGrid campaign homes'
        ),
        permitFactor(profile, permits, clipped),
        stormFactor(weather, clipped, now),
      ];
      const scored = scoreFactors(profile, factorsInput);
      const coordinates = center.geometry.coordinates;
      const cellId = `grid:${stableHash([
        campaignId,
        coordinates[0].toFixed(5),
        coordinates[1].toFixed(5),
      ]).slice(0, 16)}`;
      cells.push({
        type: 'Feature',
        geometry: clipped.geometry,
        properties: {
          cellId,
          score: scored.score,
          confidence: scored.confidence,
          confidenceLabel: confidenceLabel(scored.confidence),
          rank: null,
          targetHomeCount: targets.length,
          factors: scored.factors,
          censusDguid: censusProperties.dguid ?? null,
        },
      });
    }

    cells
      .filter((cell) => cell.properties.score !== null)
      .sort((left, right) => Number(right.properties.score) - Number(left.properties.score))
      .forEach((cell, index) => {
        cell.properties.rank = index + 1;
      });
    const totalHomes = cells.reduce((sum, cell) => sum + cell.properties.targetHomeCount, 0);
    const scoredCells = cells.filter((cell) => cell.properties.score !== null);
    const overallScore = scoredCells.length
      ? Math.round(
          scoredCells.reduce(
            (sum, cell) => sum + Number(cell.properties.score) * cell.properties.targetHomeCount,
            0
          ) /
          scoredCells.reduce((sum, cell) => sum + cell.properties.targetHomeCount, 0)
        )
      : null;
    const overallConfidence = totalHomes
      ? cells.reduce(
          (sum, cell) => sum + cell.properties.confidence * cell.properties.targetHomeCount,
          0
        ) / totalHomes
      : 0;
    const aggregate = aggregateFactors(cells);
    const missingFactors = aggregate
      .filter((candidate) => !candidate.available && profile.weights[candidate.key] > 0)
      .map((candidate) => candidate.key);
    const status = overallScore === null
      ? 'insufficient_data'
      : missingFactors.length ? 'partial' : 'ready';
    const benchmark =
      censusAreas[0]?.properties?.market_key ||
      censusAreas[0]?.properties?.province_code ||
      campaign.region ||
      'campaign area';
    const sources: TerritoryIQSource[] = [
      {
        key: 'wolfgrid-campaign-map',
        provider: 'WolfGrid',
        dataset: 'Campaign homes, buildings and routes',
        version: String(bundle.source_version ?? bundle.asset_signature ?? 'current'),
        releaseDate: typeof bundle.built_at === 'string' ? bundle.built_at : null,
        freshness: 'Campaign snapshot',
      },
    ];
    if (censusAreas.length) {
      sources.push({
        key: 'statcan-census-profile-da-2021',
        provider: censusAreas[0].properties?.source_provider ?? 'Statistics Canada',
        dataset: 'Census Profile — dissemination areas',
        version: censusAreas[0].properties?.source_version ?? '2021',
        releaseDate: censusAreas[0].properties?.source_release_date ?? null,
        freshness: '2021 Census',
      });
    }
    if (permits.length) {
      sources.push({
        key: 'municipal-permits',
        provider: 'Participating municipalities',
        dataset: 'Residential permits pilot',
        version: 'promoted',
        releaseDate: null,
        freshness: 'Varies by municipality',
      });
    }
    if (weather.length) {
      sources.push({
        key: 'verified-weather-events',
        provider: 'Verified weather provider',
        dataset: 'Hail and wind event pilot',
        version: 'promoted',
        releaseDate: null,
        freshness: 'Event feed',
      });
    }

    const inputHash = stableHash({
      campaign: [campaign.updated_at, campaign.map_ready_at],
      profile: profile.key,
      model: GRID_SCORE_MODEL_VERSION,
      homes: addressPoints.map((entry) => entry.address.id).sort(),
      bundle: [bundle.asset_signature, bundle.source_version],
      census: censusAreas.map((area) => [area.properties?.dguid, area.properties?.source_version]).sort(),
      enrichments: [permits.length, weather.length],
    });
    const idempotencyKey = `${campaignId}:${GRID_SCORE_MODEL_VERSION}:${inputHash}`;
    const runResult = claimedRunId
      ? await this.supabase
        .from('territory_iq_score_runs')
        .update({
          input_hash: inputHash,
          model_key: profile.key,
          model_version: GRID_SCORE_MODEL_VERSION,
          status: 'processing',
          requested_by: requestedBy,
          started_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('id', claimedRunId)
        .select('id')
        .single()
      : await this.supabase
        .from('territory_iq_score_runs')
        .upsert({
          campaign_id: campaignId,
          workspace_id: campaign.workspace_id,
          idempotency_key: idempotencyKey,
          input_hash: inputHash,
          model_key: profile.key,
          model_version: GRID_SCORE_MODEL_VERSION,
          status: 'processing',
          requested_by: requestedBy,
          started_at: now.toISOString(),
          updated_at: now.toISOString(),
        }, { onConflict: 'idempotency_key' })
        .select('id')
        .single();
    const { data: runData, error: runError } = runResult;
    if (runError) throw new Error(runError.message);
    const explanation = overallScore === null
      ? 'Not enough independent core signals are available for a reliable GRID SCORE yet.'
      : status === 'partial'
        ? 'GRID SCORE uses the available factors and automatically redistributes unavailable pilot weights.'
        : 'GRID SCORE combines property fit, household context and field efficiency relative to the local market.';
    const calculatedAt = now.toISOString();
    const { data: scoreData, error: scoreError } = await this.supabase
      .from('campaign_territory_iq_scores')
      .upsert({
        campaign_id: campaignId,
        workspace_id: campaign.workspace_id,
        run_id: runData.id,
        status,
        score: overallScore,
        confidence: overallConfidence,
        confidence_label: confidenceLabel(overallConfidence),
        target_home_count: totalHomes,
        model_key: profile.key,
        model_name: profile.displayName,
        model_version: GRID_SCORE_MODEL_VERSION,
        benchmark,
        explanation,
        factors: aggregate,
        sources,
        missing_factors: missingFactors,
        input_hash: inputHash,
        calculated_at: calculatedAt,
      }, { onConflict: 'campaign_id,model_version,input_hash' })
      .select('id')
      .single();
    if (scoreError) throw new Error(scoreError.message);
    await this.supabase
      .from('campaign_territory_iq_cells')
      .delete()
      .eq('score_id', scoreData.id);
    if (cells.length) {
      const addressIdsByCell = new Map<string, string[]>();
      for (const cell of cells) {
        addressIdsByCell.set(
          cell.properties.cellId,
          addressPoints
            .filter((entry) => containsPoint(cell, entry.point))
            .map((entry) => entry.address.id)
        );
      }
      const { error: cellsError } = await this.supabase
        .from('campaign_territory_iq_cells')
        .insert(cells.map((cell) => ({
          score_id: scoreData.id,
          campaign_id: campaignId,
          workspace_id: campaign.workspace_id,
          cell_key: cell.properties.cellId,
          geom: geometryToEwkt(cell.geometry),
          target_home_count: cell.properties.targetHomeCount,
          target_address_ids: addressIdsByCell.get(cell.properties.cellId) ?? [],
          score: cell.properties.score,
          confidence: cell.properties.confidence,
          confidence_label: cell.properties.confidenceLabel,
          rank: cell.properties.rank,
          factors: cell.properties.factors,
          census_dguid: cell.properties.censusDguid,
        })));
      if (cellsError) throw new Error(cellsError.message);
    }
    await this.supabase
      .from('territory_iq_score_runs')
      .update({
        status: 'completed',
        completed_at: calculatedAt,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: calculatedAt,
      })
      .eq('id', runData.id);

    return {
      status,
      model: { key: profile.key, displayName: profile.displayName, version: GRID_SCORE_MODEL_VERSION },
      overall: {
        score: overallScore,
        confidence: overallConfidence,
        confidenceLabel: confidenceLabel(overallConfidence),
        targetHomeCount: totalHomes,
        explanation,
        benchmark,
        calculatedAt,
      },
      factors: aggregate,
      cells: { type: 'FeatureCollection', features: cells },
      sources,
      missingFactors,
      retryMessage: null,
    };
  }

  private emptyResponse(profile: TerritoryIQProfile, targetHomeCount: number): TerritoryIQResponse {
    return {
      status: 'insufficient_data',
      model: { key: profile.key, displayName: profile.displayName, version: GRID_SCORE_MODEL_VERSION },
      overall: {
        score: null,
        confidence: 0,
        confidenceLabel: 'very_low',
        targetHomeCount,
        explanation: 'Campaign homes need valid coordinates before Territory IQ can score this area.',
        benchmark: 'campaign area',
        calculatedAt: null,
      },
      factors: [],
      cells: { type: 'FeatureCollection', features: [] },
      sources: [],
      missingFactors: Object.keys(profile.weights).filter(
        (key) => profile.weights[key as TerritoryIQFactorKey] > 0
      ) as TerritoryIQFactorKey[],
      retryMessage: 'Refresh after campaign map preparation completes.',
    };
  }
}
