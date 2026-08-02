import assert from 'node:assert/strict';
import {
  TERRITORY_IQ_PROFILES,
  confidenceLabel,
  homeAgeOpportunityScore,
  profileForIndustry,
  scoreFactors,
} from '../scoring';
import type { TerritoryIQFactor, TerritoryIQFactorKey } from '../types';

function input(
  key: TerritoryIQFactorKey,
  score: number | null,
  confidence = score === null ? 0 : 1
): Omit<TerritoryIQFactor, 'configuredWeight' | 'effectiveWeight' | 'contribution'> {
  return {
    key,
    label: key,
    rawValue: score,
    rawUnit: null,
    score,
    confidence,
    available: score !== null,
    source: score === null ? null : 'fixture',
    areaEstimate: false,
  };
}

for (const profile of Object.values(TERRITORY_IQ_PROFILES)) {
  assert.equal(
    Object.values(profile.weights).reduce((sum, weight) => sum + weight, 0),
    100,
    `${profile.key} weights must total 100`
  );
}

assert.equal(profileForIndustry('Roofing & Exteriors').key, 'roofing');
assert.equal(profileForIndustry('Solar/Home Services').key, 'solar');
assert.equal(profileForIndustry('Pest Control').key, 'pest_control');
assert.equal(profileForIndustry('Political / Canvassing').key, 'political');
assert.equal(profileForIndustry('Home Security').key, 'security');
assert.equal(profileForIndustry('Something new').key, 'generic');

assert.equal(homeAgeOpportunityScore('roofing', 20), 100);
assert.equal(homeAgeOpportunityScore('roofing', 5), 0);
assert.ok(homeAgeOpportunityScore('solar', 8) > homeAgeOpportunityScore('solar', 32));

assert.equal(confidenceLabel(0.8), 'high');
assert.equal(confidenceLabel(0.55), 'medium');
assert.equal(confidenceLabel(0.25), 'low');
assert.equal(confidenceLabel(0.249), 'very_low');

const roofing = TERRITORY_IQ_PROFILES.roofing;
const complete = scoreFactors(roofing, [
  input('home_age_opportunity', 80),
  input('detached_home_fit', 70),
  input('owner_occupancy', 60),
  input('household_income', 50),
  input('canvassability', 40),
  input('permit_activity', 30),
  input('local_need', 25),
  input('storm_exposure', 20),
]);
assert.equal(complete.score, 59);
assert.equal(complete.confidence, 1);

const goldenScores: Record<string, number> = {
  roofing: 59,
  solar: 59,
  hvac: 61,
  pest_control: 59,
  real_estate: 57,
  home_service: 57,
  insurance: 46,
  political: 48,
  security: 49,
  generic: 56,
};
for (const profile of Object.values(TERRITORY_IQ_PROFILES)) {
  const result = scoreFactors(profile, [
    input('home_age_opportunity', 80),
    input('detached_home_fit', 70),
    input('owner_occupancy', 60),
    input('household_income', 50),
    input('canvassability', 40),
    input('permit_activity', 30),
    input('local_need', 25),
    input('storm_exposure', 20),
  ]);
  assert.equal(result.score, goldenScores[profile.key], `${profile.key} golden fixture changed`);
}

const withoutPilots = scoreFactors(roofing, [
  input('home_age_opportunity', 80),
  input('detached_home_fit', 70),
  input('owner_occupancy', 60),
  input('household_income', 50),
  input('canvassability', 40),
  input('permit_activity', null),
  input('local_need', null),
  input('storm_exposure', null),
]);
assert.equal(withoutPilots.score, 66);
assert.equal(Number(withoutPilots.confidence.toFixed(2)), 0.83);
assert.equal(
  Math.round(withoutPilots.factors.reduce((sum, factor) => sum + factor.effectiveWeight, 0)),
  100
);

const insufficient = scoreFactors(roofing, [
  input('home_age_opportunity', 80, 0.2),
  input('detached_home_fit', null),
  input('owner_occupancy', null),
  input('household_income', null),
  input('canvassability', null),
  input('permit_activity', null),
  input('local_need', null),
  input('storm_exposure', null),
]);
assert.equal(insufficient.score, null);

console.log('Territory IQ scoring tests passed');
