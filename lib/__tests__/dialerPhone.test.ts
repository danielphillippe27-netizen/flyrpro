/**
 * Run with: npx tsx lib/__tests__/dialerPhone.test.ts
 */

import {
  getPhoneAreaCode,
  normalizePhoneNumber,
  phoneMarketFromCountryCode,
} from '../dialer/phone';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
    testsPassed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    testsFailed += 1;
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test('parses South Africa local and E.164 numbers with area metadata', () => {
  const local = normalizePhoneNumber('011 234 5678', 'ZA');
  assertEqual(local.e164, '+27112345678');
  assertEqual(local.countryCode, 'ZA');
  assertEqual(local.areaCode, '011');
  assertEqual(local.areaLabel, 'South Africa 011');

  const mobile = normalizePhoneNumber('+27821234567', 'US');
  assertEqual(mobile.e164, '+27821234567');
  assertEqual(mobile.areaCode, '082');
});

test('parses Australia local and mobile area buckets', () => {
  const sydney = normalizePhoneNumber('02 9374 4000', 'AU');
  assertEqual(sydney.e164, '+61293744000');
  assertEqual(sydney.countryCode, 'AU');
  assertEqual(sydney.areaCode, '02');

  const mobile = normalizePhoneNumber('0412 345 678', 'AU');
  assertEqual(mobile.e164, '+61412345678');
  assertEqual(mobile.areaCode, '04');
});

test('parses New Zealand local and mobile area buckets', () => {
  const auckland = normalizePhoneNumber('09 123 4567', 'NZ');
  assertEqual(auckland.e164, '+6491234567');
  assertEqual(auckland.countryCode, 'NZ');
  assertEqual(auckland.areaCode, '09');

  const mobile = normalizePhoneNumber('021 123 4567', 'NZ');
  assertEqual(mobile.e164, '+64211234567');
  assertEqual(mobile.areaCode, '02');
});

test('keeps US and Canada NANP area extraction', () => {
  assertEqual(normalizePhoneNumber('305 555 0123', 'US').areaCode, '305');
  assertEqual(normalizePhoneNumber('289 675 2788', 'CA').areaCode, '289');
});

test('rejects local international numbers under the wrong market', () => {
  const wrongMarket = normalizePhoneNumber('021 123 4567', 'US');
  assert(!wrongMarket.isValid, 'New Zealand local number should not pass US parsing');
  assertEqual(wrongMarket.e164, null);
});

test('normalizes supported profile country codes to phone markets', () => {
  assertEqual(phoneMarketFromCountryCode('za'), 'ZA');
  assertEqual(phoneMarketFromCountryCode('AU'), 'AU');
  assertEqual(phoneMarketFromCountryCode('GB'), 'US');
});

test('extracts area codes directly from national numbers', () => {
  assertEqual(getPhoneAreaCode('ZA', '821234567'), '082');
  assertEqual(getPhoneAreaCode('AU', '293744000'), '02');
  assertEqual(getPhoneAreaCode('NZ', '91234567'), '09');
});

if (testsFailed > 0) {
  console.error(`${testsFailed} dialer phone test${testsFailed === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

console.log(`${testsPassed} dialer phone tests passed.`);
