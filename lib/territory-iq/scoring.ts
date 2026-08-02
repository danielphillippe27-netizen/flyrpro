import type {
  TerritoryIQConfidenceLabel,
  TerritoryIQFactor,
  TerritoryIQFactorKey,
} from './types';

export const GRID_SCORE_MODEL_VERSION = 'grid-score-v2-toronto';

export type TerritoryIQProfile = {
  key: string;
  displayName: string;
  weights: Record<TerritoryIQFactorKey, number>;
};

const weights = (
  age: number,
  detached: number,
  owner: number,
  income: number,
  canvass: number,
  permits: number,
  storm: number,
  localNeed: number
): Record<TerritoryIQFactorKey, number> => ({
  home_age_opportunity: age,
  detached_home_fit: detached,
  owner_occupancy: owner,
  household_income: income,
  canvassability: canvass,
  permit_activity: permits,
  storm_exposure: storm,
  local_need: localNeed,
});

export const TERRITORY_IQ_PROFILES: Record<string, TerritoryIQProfile> = {
  roofing: {
    key: 'roofing',
    displayName: 'Roofing & Exteriors',
    weights: weights(30, 19, 14, 10, 10, 7, 5, 5),
  },
  solar: {
    key: 'solar',
    displayName: 'Solar',
    weights: weights(10, 25, 25, 25, 10, 5, 0, 0),
  },
  hvac: {
    key: 'hvac',
    displayName: 'HVAC',
    weights: weights(28, 19, 19, 14, 10, 5, 0, 5),
  },
  pest_control: {
    key: 'pest_control',
    displayName: 'Pest Control',
    weights: weights(18, 24, 24, 10, 14, 5, 0, 5),
  },
  real_estate: {
    key: 'real_estate',
    displayName: 'Real Estate',
    weights: weights(19, 14, 24, 19, 14, 5, 0, 5),
  },
  home_service: {
    key: 'home_service',
    displayName: 'Home Service',
    weights: weights(14, 24, 19, 14, 19, 5, 0, 5),
  },
  insurance: {
    key: 'insurance',
    displayName: 'Insurance',
    weights: weights(13, 14, 14, 9, 9, 5, 26, 10),
  },
  political: {
    key: 'political',
    displayName: 'Political / Canvassing',
    weights: weights(0, 10, 15, 20, 55, 0, 0, 0),
  },
  security: {
    key: 'security',
    displayName: 'Home Security',
    weights: weights(10, 15, 15, 15, 15, 5, 5, 20),
  },
  generic: {
    key: 'generic',
    displayName: 'Field Sales',
    weights: weights(14, 19, 19, 19, 19, 5, 0, 5),
  },
};

export function profileForIndustry(industry: string | null | undefined): TerritoryIQProfile {
  const normalized = String(industry ?? '').trim().toLowerCase();
  if (normalized.includes('roof') || normalized.includes('exterior')) return TERRITORY_IQ_PROFILES.roofing;
  if (normalized.includes('solar')) return TERRITORY_IQ_PROFILES.solar;
  if (normalized.includes('hvac')) return TERRITORY_IQ_PROFILES.hvac;
  if (normalized.includes('pest')) return TERRITORY_IQ_PROFILES.pest_control;
  if (normalized.includes('real estate')) return TERRITORY_IQ_PROFILES.real_estate;
  if (normalized.includes('insurance')) return TERRITORY_IQ_PROFILES.insurance;
  if (normalized.includes('security')) return TERRITORY_IQ_PROFILES.security;
  if (normalized.includes('political') || normalized.includes('canvass')) return TERRITORY_IQ_PROFILES.political;
  if (
    normalized.includes('home service') ||
    normalized.includes('landscap') ||
    normalized.includes('pool')
  ) {
    return TERRITORY_IQ_PROFILES.home_service;
  }
  return TERRITORY_IQ_PROFILES.generic;
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function triangularScore(age: number, low: number, peakLow: number, peakHigh: number, high: number): number {
  if (age <= low || age >= high) return 0;
  if (age >= peakLow && age <= peakHigh) return 100;
  if (age < peakLow) return 100 * (age - low) / Math.max(1, peakLow - low);
  return 100 * (high - age) / Math.max(1, high - peakHigh);
}

export function homeAgeOpportunityScore(profileKey: string, age: number): number {
  if (profileKey === 'roofing') return clampScore(triangularScore(age, 8, 15, 30, 45));
  if (profileKey === 'solar') return clampScore(triangularScore(age, -1, 0, 15, 35));
  if (profileKey === 'hvac') return clampScore(triangularScore(age, 5, 15, 35, 55));
  if (profileKey === 'insurance') return clampScore(triangularScore(age, 5, 20, 50, 80));
  return clampScore(triangularScore(age, 3, 12, 40, 80));
}

export function confidenceLabel(confidence: number): TerritoryIQConfidenceLabel {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.55) return 'medium';
  if (confidence >= 0.25) return 'low';
  return 'very_low';
}

export function scoreFactors(
  profile: TerritoryIQProfile,
  inputs: Array<Omit<TerritoryIQFactor, 'configuredWeight' | 'effectiveWeight' | 'contribution'>>
): { score: number | null; confidence: number; factors: TerritoryIQFactor[] } {
  const weightedInputs = inputs.map((input) => ({
    ...input,
    configuredWeight: profile.weights[input.key],
  }));
  const denominator = weightedInputs.reduce(
    (sum, factor) =>
      factor.available && factor.score !== null
        ? sum + factor.configuredWeight * factor.confidence
        : sum,
    0
  );
  const confidence = profile.weights
    ? Object.values(profile.weights).reduce((sum, weight) => sum + weight, 0) > 0
      ? denominator / 100
      : 0
    : 0;
  const factors = weightedInputs.map((factor): TerritoryIQFactor => {
    const effectiveWeight =
      denominator > 0 && factor.available && factor.score !== null
        ? (factor.configuredWeight * factor.confidence / denominator) * 100
        : 0;
    return {
      ...factor,
      effectiveWeight,
      contribution: factor.score === null ? 0 : factor.score * effectiveWeight / 100,
    };
  });
  const availableCore = factors.filter(
    (factor) =>
      factor.available &&
      factor.score !== null &&
      !(['permit_activity', 'storm_exposure', 'local_need'] as TerritoryIQFactorKey[]).includes(factor.key)
  ).length;
  if (denominator <= 0 || availableCore < 2 || confidence < 0.25) {
    return { score: null, confidence, factors };
  }
  const value = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  return { score: Math.round(clampScore(value)), confidence, factors };
}
