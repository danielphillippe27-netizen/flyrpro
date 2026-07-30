export type TerritoryIQStatus =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'partial'
  | 'insufficient_data'
  | 'failed';

export type TerritoryIQConfidenceLabel = 'high' | 'medium' | 'low' | 'very_low';

export type TerritoryIQFactorKey =
  | 'home_age_opportunity'
  | 'detached_home_fit'
  | 'owner_occupancy'
  | 'household_income'
  | 'canvassability'
  | 'permit_activity'
  | 'storm_exposure';

export type TerritoryIQFactor = {
  key: TerritoryIQFactorKey;
  label: string;
  rawValue: number | null;
  rawUnit: string | null;
  score: number | null;
  configuredWeight: number;
  effectiveWeight: number;
  confidence: number;
  available: boolean;
  source: string | null;
  areaEstimate: boolean;
  contribution: number;
};

export type TerritoryIQSource = {
  key: string;
  provider: string;
  dataset: string;
  version: string;
  releaseDate: string | null;
  freshness: string;
};

export type TerritoryIQCellProperties = {
  cellId: string;
  score: number | null;
  confidence: number;
  confidenceLabel: TerritoryIQConfidenceLabel;
  rank: number | null;
  targetHomeCount: number;
  factors: TerritoryIQFactor[];
  censusDguid: string | null;
};

export type TerritoryIQResponse = {
  status: TerritoryIQStatus;
  model: {
    key: string;
    displayName: string;
    version: string;
  };
  overall: {
    score: number | null;
    confidence: number;
    confidenceLabel: TerritoryIQConfidenceLabel;
    targetHomeCount: number;
    explanation: string;
    benchmark: string;
    calculatedAt: string | null;
  };
  factors: TerritoryIQFactor[];
  cells: GeoJSON.FeatureCollection<GeoJSON.Geometry, TerritoryIQCellProperties>;
  sources: TerritoryIQSource[];
  missingFactors: TerritoryIQFactorKey[];
  retryMessage: string | null;
};
