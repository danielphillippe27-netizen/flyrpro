/**
 * Run with: npx tsx lib/__tests__/qrBase64.test.ts
 */

import assert from 'node:assert/strict';

function stripBase64Prefix(raw: string): string {
  return raw.startsWith('data:') ? raw.split(',')[1] : raw.replace(/\s/g, '');
}

function decodeBase64ToPng(raw: string): Uint8Array {
  const base64 = stripBase64Prefix(raw);
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

const oneByOnePngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

assert.equal(
  stripBase64Prefix(`data:image/png;base64,${oneByOnePngBase64}`),
  oneByOnePngBase64
);
assert.equal(stripBase64Prefix(oneByOnePngBase64), oneByOnePngBase64);
assert.equal(stripBase64Prefix('a b\nc\t d'), 'abcd');
assert.equal(stripBase64Prefix(''), '');

assert.doesNotThrow(() => decodeBase64ToPng(oneByOnePngBase64));
assert.ok(decodeBase64ToPng(oneByOnePngBase64).length > 0);

assert.doesNotThrow(() => decodeBase64ToPng(`data:image/png;base64,${oneByOnePngBase64}`));
assert.ok(decodeBase64ToPng(`data:image/png;base64,${oneByOnePngBase64}`).length > 0);

assert.throws(() => decodeBase64ToPng('not valid base64!'));

console.log('qrBase64 tests passed');
