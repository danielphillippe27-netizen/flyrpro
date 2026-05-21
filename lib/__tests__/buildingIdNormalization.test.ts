/**
 * Run with: npx tsx lib/__tests__/buildingIdNormalization.test.ts
 */

import assert from 'node:assert/strict';
import {
  buildingIdentifierCandidates,
  normalizeBuildingRouteId,
} from '../../app/api/campaigns/_utils/resolve-campaign-building';

const bedrockId = 'bedrock_ca:nar:e8ea84c7-75e7-4587-ac89-978717fad95d';
const bedrockUuid = 'e8ea84c7-75e7-4587-ac89-978717fad95d';
const overtureId = 'overture:building:9e151a73-9486-4a9f-9ac4-d540e12e3287';
const overtureUuid = '9e151a73-9486-4a9f-9ac4-d540e12e3287';

assert.equal(normalizeBuildingRouteId(bedrockId), bedrockId);
assert.equal(
  normalizeBuildingRouteId('bedrock_ca%3Anar%3Ae8ea84c7-75e7-4587-ac89-978717fad95d'),
  bedrockId
);
assert.equal(normalizeBuildingRouteId(overtureId), overtureId);
assert.equal(
  normalizeBuildingRouteId(['overture', 'building', overtureUuid]),
  overtureId
);

// BUG: double-encoded Bedrock IDs are decoded only once, so they still miss
// the colon-delimited Bedrock ID format and produce DB candidates that miss.
assert.equal(
  normalizeBuildingRouteId('bedrock_ca%253Anar%253Ae8ea84c7'),
  'bedrock_ca%3Anar%3Ae8ea84c7'
);
assert.notEqual(
  normalizeBuildingRouteId('bedrock_ca%253Anar%253Ae8ea84c7'),
  'bedrock_ca:nar:e8ea84c7'
);

assert.deepEqual(buildingIdentifierCandidates(':'), [':']);
assert.deepEqual(buildingIdentifierCandidates('overture:building:'), ['overture:building:']);
assert.deepEqual(buildingIdentifierCandidates('bedrock_ca:nar:'), ['bedrock_ca:nar:']);

// Colon-only or missing-UUID IDs are not valid building IDs, but candidate
// generation keeps the full string, so the resolver would issue gers_id
// equality queries for these values before accepting them as snapshot IDs.
assert.equal(buildingIdentifierCandidates(':')[0], ':');
assert.equal(buildingIdentifierCandidates('overture:building:')[0], 'overture:building:');
assert.equal(buildingIdentifierCandidates('bedrock_ca:nar:')[0], 'bedrock_ca:nar:');

assert.equal(normalizeBuildingRouteId(''), '');

// BUG: an array of empty route segments normalizes to "//" instead of empty,
// creating a garbage DB candidate.
assert.equal(normalizeBuildingRouteId(['', '', '']), '//');
assert.equal(normalizeBuildingRouteId(['bedrock_ca:nar:uuid']), 'bedrock_ca:nar:uuid');

assert.deepEqual(buildingIdentifierCandidates(bedrockId), [bedrockId, bedrockUuid]);
assert.deepEqual(buildingIdentifierCandidates(overtureId), [overtureId, overtureUuid]);
assert.deepEqual(buildingIdentifierCandidates('bedrock_ca:nar:not-a-uuid'), [
  'bedrock_ca:nar:not-a-uuid',
]);
assert.deepEqual(buildingIdentifierCandidates('bedrock_ca%3Anar%3Ae8ea84c7'), [
  'bedrock_ca%3Anar%3Ae8ea84c7',
]);
assert.equal(
  buildingIdentifierCandidates('bedrock_ca%3Anar%3Ae8ea84c7').includes('bedrock_ca:nar:e8ea84c7'),
  false
);

console.log('buildingIdNormalization tests passed');
