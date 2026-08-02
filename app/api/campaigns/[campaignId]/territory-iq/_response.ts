import * as wkx from 'wkx';
import type {
  TerritoryIQCellProperties,
  TerritoryIQFactor,
  TerritoryIQFactorKey,
  TerritoryIQInsight,
  TerritoryIQResponse,
  TerritoryIQSource,
} from '@/lib/territory-iq/types';

type ScoreRow = {
  id: string;
  status: 'ready' | 'partial' | 'insufficient_data' | 'failed';
  score: number | null;
  confidence: number;
  confidence_label: 'high' | 'medium' | 'low' | 'very_low';
  target_home_count: number;
  model_key: string;
  model_name: string;
  model_version: string;
  benchmark: string;
  explanation: string;
  factors: TerritoryIQFactor[];
  sources: TerritoryIQSource[];
  insights: TerritoryIQInsight[];
  missing_factors: TerritoryIQFactorKey[];
  calculated_at: string;
};

type CellRow = {
  cell_key: string;
  geom: unknown;
  target_home_count: number;
  target_address_ids: string[];
  score: number | null;
  confidence: number;
  confidence_label: 'high' | 'medium' | 'low' | 'very_low';
  rank: number | null;
  factors: TerritoryIQFactor[];
  census_dguid: string | null;
};

export function decodeTerritoryIQGeometry(value: unknown): GeoJSON.Geometry | null {
  if (value && typeof value === 'object') {
    const geometry = value as Partial<GeoJSON.Geometry>;
    if (typeof geometry.type === 'string' && 'coordinates' in geometry) {
      return geometry as GeoJSON.Geometry;
    }
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as GeoJSON.Geometry;
    if (parsed && typeof parsed.type === 'string' && 'coordinates' in parsed) return parsed;
  } catch {
    // PostGIS geometry columns are commonly returned by PostgREST as EWKB hex.
  }
  try {
    const geometry = /^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0
      ? wkx.Geometry.parse(Buffer.from(trimmed, 'hex'))
      : wkx.Geometry.parse(trimmed);
    return geometry.toGeoJSON() as GeoJSON.Geometry;
  } catch {
    return null;
  }
}

function aggregateFactors(cells: CellRow[]): TerritoryIQFactor[] {
  const totalHomes = cells.reduce((sum, cell) => sum + cell.target_home_count, 0);
  const factors = new Map<TerritoryIQFactorKey, Array<{ factor: TerritoryIQFactor; homes: number }>>();
  for (const cell of cells) {
    for (const factor of cell.factors ?? []) {
      const entries = factors.get(factor.key) ?? [];
      entries.push({ factor, homes: cell.target_home_count });
      factors.set(factor.key, entries);
    }
  }
  return Array.from(factors.values()).map((entries) => {
    const first = entries[0].factor;
    const weighted = (selector: (factor: TerritoryIQFactor) => number) =>
      totalHomes
        ? entries.reduce((sum, entry) => sum + selector(entry.factor) * entry.homes, 0) / totalHomes
        : 0;
    const raw = entries.filter((entry) => entry.factor.rawValue !== null);
    return {
      ...first,
      rawValue: raw.length
        ? raw.reduce((sum, entry) => sum + Number(entry.factor.rawValue) * entry.homes, 0) /
          raw.reduce((sum, entry) => sum + entry.homes, 0)
        : null,
      score: entries.some((entry) => entry.factor.score !== null)
        ? weighted((factor) => factor.score ?? 0)
        : null,
      confidence: weighted((factor) => factor.confidence),
      effectiveWeight: weighted((factor) => factor.effectiveWeight),
      contribution: weighted((factor) => factor.contribution),
    };
  });
}

export function responseFromRows(
  score: ScoreRow,
  allCells: CellRow[],
  assignedAddressIds: Set<string> | null
): TerritoryIQResponse {
  const cells = assignedAddressIds
    ? allCells.filter((cell) =>
        (cell.target_address_ids ?? []).some((addressId) => assignedAddressIds.has(addressId))
      )
    : allCells;
  const totalHomes = cells.reduce((sum, cell) => sum + cell.target_home_count, 0);
  const scoredCells = cells.filter((cell) => cell.score !== null);
  const scopedScore = scoredCells.length
    ? Math.round(
        scoredCells.reduce(
          (sum, cell) => sum + Number(cell.score) * cell.target_home_count,
          0
        ) /
        scoredCells.reduce((sum, cell) => sum + cell.target_home_count, 0)
      )
    : null;
  const scopedConfidence = totalHomes
    ? cells.reduce((sum, cell) => sum + cell.confidence * cell.target_home_count, 0) / totalHomes
    : 0;
  const features: Array<GeoJSON.Feature<GeoJSON.Geometry, TerritoryIQCellProperties>> = cells.flatMap(
    (cell) => {
      const geometry = decodeTerritoryIQGeometry(cell.geom);
      if (!geometry) return [];
      return [{
        type: 'Feature',
        geometry,
        properties: {
          cellId: cell.cell_key,
          score: cell.score,
          confidence: cell.confidence,
          confidenceLabel: cell.confidence_label,
          rank: cell.rank,
          targetHomeCount: cell.target_home_count,
          factors: cell.factors ?? [],
          censusDguid: cell.census_dguid,
        },
      }];
    }
  );
  const factors = assignedAddressIds ? aggregateFactors(cells) : score.factors ?? [];
  const missingFactors = factors
    .filter((factor) => !factor.available && factor.configuredWeight > 0)
    .map((factor) => factor.key);
  return {
    status:
      scopedScore === null
        ? 'insufficient_data'
        : missingFactors.length
          ? 'partial'
          : score.status === 'failed' ? 'failed' : 'ready',
    model: {
      key: score.model_key,
      displayName: score.model_name,
      version: score.model_version,
    },
    overall: {
      score: assignedAddressIds ? scopedScore : score.score,
      confidence: assignedAddressIds ? scopedConfidence : Number(score.confidence),
      confidenceLabel:
        scopedConfidence >= 0.8
          ? 'high'
          : scopedConfidence >= 0.55
            ? 'medium'
            : scopedConfidence >= 0.25 ? 'low' : 'very_low',
      targetHomeCount: assignedAddressIds ? totalHomes : score.target_home_count,
      explanation: assignedAddressIds
        ? `${score.explanation} This view is limited to your assigned homes.`
        : score.explanation,
      benchmark: score.benchmark,
      calculatedAt: score.calculated_at,
    },
    factors,
    cells: { type: 'FeatureCollection', features },
    sources: score.sources ?? [],
    insights: score.insights ?? [],
    missingFactors: assignedAddressIds ? missingFactors : score.missing_factors ?? [],
    retryMessage: score.status === 'failed' ? 'Refresh Territory IQ to try again.' : null,
  };
}

export type { CellRow, ScoreRow };
