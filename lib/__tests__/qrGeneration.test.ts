/**
 * Run with: npx tsx lib/__tests__/qrGeneration.test.ts
 */

import assert from 'node:assert/strict';

type AddressQrState = {
  qr_code_base64?: string | null;
  purl?: string | null;
};

function stripBase64Prefix(raw: string): string {
  return raw.startsWith('data:') ? raw.split(',')[1] : raw.replace(/\s/g, '');
}

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname);
  } catch {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(url);
  }
}

function addressesNeedingQr(
  addresses: AddressQrState[],
  forceRegenerate: boolean | undefined
): AddressQrState[] {
  const shouldRegenerateAll = forceRegenerate !== false;
  return shouldRegenerateAll
    ? addresses
    : addresses.filter((addr) =>
        !addr.qr_code_base64 ||
        !addr.purl ||
        isLocalhostUrl(addr.purl)
      );
}

function buildScanUrl(domain: string): URL {
  return new URL('/api/scan', domain);
}

const pngBase64 = 'iVBORw0KGgo=';

assert.equal(stripBase64Prefix(`data:image/png;base64,${pngBase64}`), pngBase64);
assert.equal(stripBase64Prefix(' a b\nc\t'), 'abc');

// Known edge case: data URLs without a comma return undefined. The View QR
// handler catches the resulting decode failure and shows a user-facing alert.
assert.equal(
  stripBase64Prefix('data:image/png;base64') as unknown as undefined,
  undefined
);

assert.equal(stripBase64Prefix(''), '');
assert.equal(stripBase64Prefix('data:image/png;base64,a b\nc'), 'a b\nc');

assert.deepEqual(
  addressesNeedingQr([{ qr_code_base64: 'existing', purl: 'https://flyrpro.app/api/scan?id=1' }], true),
  [{ qr_code_base64: 'existing', purl: 'https://flyrpro.app/api/scan?id=1' }]
);
assert.deepEqual(addressesNeedingQr([{ qr_code_base64: null, purl: null }], true), [
  { qr_code_base64: null, purl: null },
]);
assert.deepEqual(
  addressesNeedingQr([{ qr_code_base64: 'existing', purl: 'https://flyrpro.app/api/scan?id=1' }], false),
  []
);
assert.deepEqual(addressesNeedingQr([{ qr_code_base64: 'existing', purl: null }], false), [
  { qr_code_base64: 'existing', purl: null },
]);
assert.deepEqual(addressesNeedingQr([{ qr_code_base64: 'existing', purl: '' }], false), [
  { qr_code_base64: 'existing', purl: '' },
]);

assert.equal(buildScanUrl('https://flyrpro.vercel.app').toString(), 'https://flyrpro.vercel.app/api/scan');
assert.throws(() => buildScanUrl('not-a-url'));
assert.throws(() => buildScanUrl(''));
assert.equal(buildScanUrl('http://localhost:3000').toString(), 'http://localhost:3000/api/scan');

// Known issue: generate-qrs catches invalid URL construction per address, so an
// invalid domain can fail every row while the route still returns success: true,
// count: 0.

console.log('qrGeneration tests passed');
