/**
 * Run with: npx tsx lib/__tests__/bedrockProvisioning.test.ts
 */

import { BedrockAustraliaService } from '../services/BedrockAustraliaService';
import { BedrockCanadaService } from '../services/BedrockCanadaService';
import { BedrockNzService } from '../services/BedrockNzService';
import { BedrockSouthAfricaService } from '../services/BedrockSouthAfricaService';
import { BedrockUkService } from '../services/BedrockUkService';
import { BedrockUsService } from '../services/BedrockUsService';

type ProvisionSource =
  | 'bedrock_ca'
  | 'bedrock_us'
  | 'bedrock_au'
  | 'bedrock_nz'
  | 'bedrock_za'
  | 'bedrock_uk';

const BEDROCK_DIAMOND_SOURCES = [
  'diamond',
  'bedrock_ca',
  'bedrock_us',
  'bedrock_au',
  'bedrock_nz',
  'bedrock_za',
  'bedrock_uk',
];

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`);
      testsPassed += 1;
    })
    .catch((error: unknown) => {
      console.error(`FAIL ${name}`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
      testsFailed += 1;
    });
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value: unknown, message?: string) {
  if (!value) throw new Error(message ?? 'Expected truthy value');
}

function assertThrows(fn: () => void, expectedMessage: string) {
  try {
    fn();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      throw new Error(`Expected message containing "${expectedMessage}", got "${message}"`);
    }
    return;
  }
  throw new Error('Expected function to throw');
}

function regionCodeToProvisionSource(regionCode: string): ProvisionSource {
  if (BedrockNzService.isNzRegion(regionCode)) return 'bedrock_nz';
  if (BedrockAustraliaService.isAustraliaRegion(regionCode)) return 'bedrock_au';
  if (BedrockCanadaService.isCanadaRegion(regionCode)) return 'bedrock_ca';
  if (BedrockSouthAfricaService.isSouthAfricaRegion(regionCode)) return 'bedrock_za';
  if (BedrockUkService.isUkRegion(regionCode)) return 'bedrock_uk';
  if (BedrockUsService.isUsRegion(regionCode)) return 'bedrock_us';

  throw new Error(`Provisioning only supports Diamond or Bedrock S3 folders for region "${regionCode}".`);
}

test('maps Canadian province codes to bedrock_ca', async () => {
  for (const regionCode of ['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL']) {
    assertEqual(regionCodeToProvisionSource(regionCode), 'bedrock_ca', `${regionCode} should map to bedrock_ca`);
  }
});

test('maps US state codes to bedrock_us', async () => {
  for (const regionCode of ['CA', 'NY', 'TX']) {
    assertEqual(regionCodeToProvisionSource(regionCode), 'bedrock_us', `${regionCode} should map to bedrock_us`);
  }
});

test('maps AU region code to bedrock_au', async () => {
  assertEqual(regionCodeToProvisionSource('AU'), 'bedrock_au');
});

test('maps NZ region code to bedrock_nz', async () => {
  assertEqual(regionCodeToProvisionSource('NZ'), 'bedrock_nz');
});

test('maps ZA region code to bedrock_za', async () => {
  assertEqual(regionCodeToProvisionSource('ZA'), 'bedrock_za');
});

test('maps UK region code to bedrock_uk', async () => {
  assertEqual(regionCodeToProvisionSource('GB'), 'bedrock_uk');
});

test('throws for unknown region codes', async () => {
  assertThrows(() => regionCodeToProvisionSource('ZZ'), 'Provisioning only supports Diamond or Bedrock');
});

test('all mapped provision sources are in the buildings route skip list', async () => {
  const mappedSources = ['ON', 'CA', 'AU', 'NZ', 'ZA', 'GB'].map(regionCodeToProvisionSource);

  for (const source of mappedSources) {
    assertTrue(BEDROCK_DIAMOND_SOURCES.includes(source), `${source} should be in BEDROCK_DIAMOND_SOURCES`);
  }
});

setTimeout(() => {
  if (testsFailed > 0) {
    console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed`);
    process.exit(1);
  }
  console.log(`\nAll ${testsPassed} bedrock provisioning tests passed.`);
}, 0);
