/**
 * Run with: npx tsx lib/__tests__/bedrockIdDetection.test.ts
 */

import assert from 'node:assert/strict';

const isBedrock = (id: string | null | undefined) => /^(bedrock_|diamond:)/.test(id ?? '');

assert.equal(
  isBedrock('bedrock_ca:nar:e8ea84c7-75e7-4587-ac89-978717fad95d'),
  true
);
assert.equal(isBedrock('bedrock_us:nar:some-uuid'), true);
assert.equal(isBedrock('bedrock_au:nar:some-uuid'), true);
assert.equal(isBedrock('diamond:some-uuid'), true);
assert.equal(
  isBedrock('overture:building:9e151a73-9486-4a9f-9ac4-d540e12e3287'),
  false
);
assert.equal(isBedrock('9e151a73-9486-4a9f-9ac4-d540e12e3287'), false);
assert.equal(isBedrock(''), false);
assert.equal(isBedrock(null), false);
assert.equal(isBedrock(undefined), false);
assert.equal(isBedrock('gold:some-id'), false);

console.log('bedrockIdDetection tests passed');
