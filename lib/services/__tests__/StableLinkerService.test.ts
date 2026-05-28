/**
 * StableLinkerService regression fixtures
 *
 * Run with: npx tsx lib/services/__tests__/StableLinkerService.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { DataIntegrityError, StableLinkerService, type MatchResult } from '../StableLinkerService';
import { ParcelEnrichmentService } from '../ParcelEnrichmentService';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${name}`);
    console.error(`  ${message}`);
    testsFailed++;
  }
}

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${name}`);
    console.error(`  ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected true, got false');
  }
}

function rectangle(minLon: number, minLat: number, maxLon: number, maxLat: number): number[][] {
  return [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
}

function makeBuilding(
  id: string,
  ring: number[][],
  options: { primaryStreet?: string | null; streetName?: string | null; name?: string | null } = {}
) {
  return {
    type: 'Feature' as const,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [ring],
    },
    properties: {
      gers_id: id,
      name: options.name ?? null,
      height: null,
      layer: 'building',
      primary_street: options.primaryStreet ?? null,
      street_name: options.streetName ?? null,
    },
  };
}

function makeParcel(externalId: string, ring: number[][]) {
  return {
    externalId,
    geometry: {
      type: 'MultiPolygon' as const,
      coordinates: [[ring]],
    },
  };
}

function makeAddress(id: string, lon: number, lat: number, streetName: string) {
  return {
    id,
    gers_id: null,
    formatted: `${streetName} ${id}`,
    house_number: id,
    street_name: streetName,
    geom: {
      type: 'Point' as const,
      coordinates: [lon, lat] as [number, number],
    },
  };
}

type MockState = {
  campaignAddresses?: Array<Record<string, unknown>>;
  addressOrphans?: Array<Record<string, unknown>>;
  buildingAddressLinks?: Array<Record<string, unknown>>;
};

type MockQueryResult = { data: unknown; error: null };
type SupabaseLike = ConstructorParameters<typeof StableLinkerService>[0];
type ParcelServiceLike = ConstructorParameters<typeof ParcelEnrichmentService>[0];
type BuildingFixture = ReturnType<typeof makeBuilding>;
type AddressFixture = ReturnType<typeof makeAddress>;
type ParcelFixture = ReturnType<typeof makeParcel>;
type StableLinkerHarness = {
  matchAddressToBuilding(
    address: AddressFixture,
    buildings: BuildingFixture[],
    matchedBuildingIds: Set<string>,
    preparedParcels: unknown[]
  ): MatchResult;
  buildTownhouseRowAssignments(
    addresses: AddressFixture[],
    buildings: BuildingFixture[]
  ): Map<string, MatchResult>;
  validateUniqueAddressAssignments(
    matches: MatchResult[],
    addressById: Map<string, AddressFixture>,
    buildingById: Map<string, BuildingFixture>
  ): { matches: MatchResult[]; orphans: unknown[] };
  saveMatches(
    campaignId: string,
    matches: MatchResult[],
    overtureRelease: string,
    persistenceMode: 'silver' | 'gold'
  ): Promise<void>;
  prepareParcelBridge(parcels: ParcelFixture[], buildings: BuildingFixture[]): unknown[];
  detectMultiUnitBuildings(matches: MatchResult[]): void;
  assignOrphan(orphanId: string, buildingId: string, userId: string): Promise<void>;
};
type ParcelDatasetFixture = {
  sourceId: string;
  key: string;
  datePart: string;
  localityAliases: string[];
  isRegionWide: boolean;
};
type ParcelEnrichmentHarness = {
  selectBestParcelDataset(
    localities: string[],
    datasets: ParcelDatasetFixture[]
  ): {
    dataset: ParcelDatasetFixture | null;
    unsupportedLocalities: string[];
    localityCounts: Array<{ source_id: string; count: number }>;
  };
};

function createStableLinkerHarness(): StableLinkerHarness {
  return new StableLinkerService({} as SupabaseLike) as unknown as StableLinkerHarness;
}

function createParcelHarness(): ParcelEnrichmentHarness {
  return new ParcelEnrichmentService({} as ParcelServiceLike) as unknown as ParcelEnrichmentHarness;
}

class MockQueryBuilder implements PromiseLike<MockQueryResult> {
  private operation: 'select' | 'update' | null = null;
  private filters = new Map<string, unknown>();
  private updateValues: Record<string, unknown> | null = null;
  private head = false;
  private fromIndex = 0;
  private toIndex: number | null = null;

  constructor(
    private readonly table: string,
    private readonly state: MockState
  ) {}

  select(_columns: string, options?: { head?: boolean }) {
    this.operation = 'select';
    this.head = !!options?.head;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.operation = 'update';
    this.updateValues = values;
    return this;
  }

  insert(values: Record<string, unknown>) {
    if (this.table !== 'building_address_links') {
      return Promise.resolve({ data: null, error: null });
    }
    const rows = this.state.buildingAddressLinks ?? [];
    rows.push(values);
    this.state.buildingAddressLinks = rows;
    return Promise.resolve({ data: values, error: null });
  }

  upsert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
    if (this.table !== 'building_address_links') {
      return Promise.resolve({ data: null, error: null });
    }
    const rows = this.state.buildingAddressLinks ?? [];
    rows.push(...(Array.isArray(values) ? values : [values]));
    this.state.buildingAddressLinks = rows;
    return Promise.resolve({ data: values, error: null });
  }

  eq(column: string, value: unknown) {
    this.filters.set(column, value);
    return this;
  }

  order() {
    return this;
  }

  range(from: number, to: number) {
    this.fromIndex = from;
    this.toIndex = to;
    return this.execute();
  }

  async single() {
    const result = await this.executeSelect();
    const row = (result.data as Array<Record<string, unknown>>)[0] ?? null;
    return { data: row, error: null };
  }

  then<TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?: ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute() {
    if (this.operation === 'update') {
      return this.executeUpdate();
    }
    return this.executeSelect();
  }

  private executeSelect() {
    const rows = this.getRows();
    const filtered = rows.filter((row) =>
      Array.from(this.filters.entries()).every(([column, value]) => row[column] === value)
    );
    const sliced = this.toIndex == null ? filtered : filtered.slice(this.fromIndex, this.toIndex + 1);
    if (this.head) {
      return Promise.resolve({ data: null, error: null, count: filtered.length } as unknown as MockQueryResult);
    }
    return Promise.resolve({ data: sliced, error: null });
  }

  private executeUpdate() {
    const rows = this.getRows();
    const filtered = rows.filter((row) =>
      Array.from(this.filters.entries()).every(([column, value]) => row[column] === value)
    );
    for (const row of filtered) {
      Object.assign(row, this.updateValues);
    }
    return Promise.resolve({ data: filtered, error: null });
  }

  private getRows(): Array<Record<string, unknown>> {
    switch (this.table) {
      case 'campaign_addresses':
        return this.state.campaignAddresses ?? [];
      case 'address_orphans':
        return this.state.addressOrphans ?? [];
      case 'building_address_links':
        return this.state.buildingAddressLinks ?? [];
      default:
        return [];
    }
  }
}

function createMockSupabase(state: MockState) {
  return {
    from(table: string) {
      return new MockQueryBuilder(table, state);
    },
  };
}

async function run() {
  console.log('Running StableLinkerService regression fixtures...\n');

  test('Gold exact: containment_verified wins for same-street address inside footprint', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'building-1',
      rectangle(-79.0002, 43.0000, -78.9998, 43.0003),
      { primaryStreet: 'Main Street' }
    );
    const address = makeAddress('100', -79.0000, 43.00015, 'Main Street');

    const match = service.matchAddressToBuilding(address, [building], new Set(), []);
    assertEqual(match.matchType, 'containment_verified');
    assertEqual(match.buildingId, 'building-1');
  });

  test('Gold parcel bridge: address outside footprint still links via shared parcel', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'building-2',
      rectangle(-79.00020, 43.00000, -79.00005, 43.00018),
      { primaryStreet: 'Oak Avenue' }
    );
    const parcel = makeParcel('parcel-1', rectangle(-79.00030, 42.99995, -78.99990, 43.00028));
    const preparedParcels = service.prepareParcelBridge([parcel], [building]);
    const address = makeAddress('200', -78.99998, 43.00016, 'Oak Avenue');

    const match = service.matchAddressToBuilding(address, [building], new Set(), preparedParcels);
    assertEqual(match.matchType, 'parcel_verified');
    assertEqual(match.buildingId, 'building-2');
  });

  test('Silver parcel bridge: street_name-only buildings still participate in parcel matching', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'building-3',
      rectangle(-79.00120, 43.00100, -79.00105, 43.00118),
      { streetName: 'Pine Road' }
    );
    const parcel = makeParcel('parcel-2', rectangle(-79.00130, 43.00095, -79.00090, 43.00130));
    const preparedParcels = service.prepareParcelBridge([parcel], [building]);
    const address = makeAddress('300', -79.00098, 43.00110, 'Pine Road');

    const match = service.matchAddressToBuilding(address, [building], new Set(), preparedParcels);
    assertEqual(match.matchType, 'parcel_verified');
    assertEqual(match.buildingId, 'building-3');
  });

  test('Parcel bridge outranks point-on-surface for offset detached-home address points', () => {
    const service = new StableLinkerService({} as any);
    const parcelBuilding = makeBuilding(
      'parcel-main-home',
      rectangle(-79.00965, 43.01002, -79.00950, 43.01016),
      { primaryStreet: 'Cedar Court' }
    );
    const boundaryNeighbor = makeBuilding(
      'boundary-neighbor',
      rectangle(-79.01000, 43.01000, -79.00980, 43.01020),
      { primaryStreet: 'Cedar Court' }
    );
    const parcel = makeParcel(
      'parcel-main',
      rectangle(-79.00982, 43.00995, -79.00945, 43.01022)
    );
    const preparedParcels = (service as any).prepareParcelBridge([parcel], [parcelBuilding, boundaryNeighbor]);
    const address = makeAddress('302', -79.00980, 43.01010, 'Cedar Court');

    const match = (service as any).matchAddressToBuilding(
      address,
      [parcelBuilding, boundaryNeighbor],
      new Set(),
      preparedParcels
    );

    assertEqual(match.matchType, 'parcel_verified');
    assertEqual(match.buildingId, 'parcel-main-home');
  });

  test('Parcel source selection: locality-specific dataset beats region-wide fallback', () => {
    const service = createParcelHarness();

    const resolution = service.selectBestParcelDataset(
      ['burnaby'],
      [
        {
          sourceId: 'bc_parcels',
          key: 'gold-standard/canada/bc/bc_parcels/20260426/bc_parcels_gold.ndjson',
          datePart: '20260426',
          localityAliases: ['bc'],
          isRegionWide: true,
        },
        {
          sourceId: 'burnaby_parcels',
          key: 'gold-standard/canada/bc/burnaby_parcels/20260426/burnaby_parcels_gold.ndjson',
          datePart: '20260426',
          localityAliases: ['burnaby'],
          isRegionWide: false,
        },
      ]
    );

    assertEqual(resolution.dataset?.sourceId, 'burnaby_parcels');
    assertEqual(resolution.localityCounts, [{ source_id: 'burnaby_parcels', count: 1 }]);
    assertEqual(resolution.unsupportedLocalities, []);
  });

  test('Parcel source selection: region-wide dataset handles unsupported localities', () => {
    const service = createParcelHarness();

    const resolution = service.selectBestParcelDataset(
      ['vancouver'],
      [
        {
          sourceId: 'bc_parcels',
          key: 'gold-standard/canada/bc/bc_parcels/20260426/bc_parcels_gold.ndjson',
          datePart: '20260426',
          localityAliases: ['bc'],
          isRegionWide: true,
        },
        {
          sourceId: 'burnaby_parcels',
          key: 'gold-standard/canada/bc/burnaby_parcels/20260426/burnaby_parcels_gold.ndjson',
          datePart: '20260426',
          localityAliases: ['burnaby'],
          isRegionWide: false,
        },
      ]
    );

    assertEqual(resolution.dataset?.sourceId, 'bc_parcels');
    assertEqual(resolution.unsupportedLocalities, ['vancouver']);
  });

  test('Townhouse row: repeated containing matches can share one proven footprint', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'building-row',
      rectangle(-79.00220, 43.00200, -79.00180, 43.00230),
      { primaryStreet: 'Rowhouse Lane' }
    );

    const matchedBuildingIds = new Set<string>();
    const first = service.matchAddressToBuilding(
      makeAddress('401', -79.00212, 43.00210, 'Rowhouse Lane'),
      [building],
      matchedBuildingIds,
      []
    );
    matchedBuildingIds.add(first.buildingId);

    const second = service.matchAddressToBuilding(
      makeAddress('403', -79.00200, 43.00215, 'Rowhouse Lane'),
      [building],
      matchedBuildingIds,
      []
    );
    const third = service.matchAddressToBuilding(
      makeAddress('405', -79.00188, 43.00220, 'Rowhouse Lane'),
      [building],
      matchedBuildingIds,
      []
    );

    assertEqual(first.matchType, 'containment_verified');
    assertEqual(first.buildingId, 'building-row');
    assertEqual(second.matchType, 'containment_verified');
    assertEqual(second.buildingId, 'building-row');
    assertEqual(third.matchType, 'containment_verified');
    assertEqual(third.buildingId, 'building-row');
  });

  test('Townhouse row: same-street homes just outside one footprint preassign together', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'carey-row',
      rectangle(-79.00235, 43.00200, -79.00155, 43.00218),
      { primaryStreet: 'Carey Lane' }
    );
    const addresses = [
      makeAddress('25', -79.00224, 43.00222, 'Carey Lane'),
      makeAddress('27', -79.00204, 43.00222, 'Carey Lane'),
      makeAddress('29', -79.00184, 43.00222, 'Carey Lane'),
      makeAddress('31', -79.00164, 43.00222, 'Carey Lane'),
    ];

    const assignments = service.buildTownhouseRowAssignments(addresses, [building]);

    assertEqual(assignments.size, 4);
    for (const address of addresses) {
      assertEqual(assignments.get(address.id)?.buildingId, 'carey-row');
      assertEqual(assignments.get(address.id)?.matchType, 'proximity_verified');
      assertTrue((assignments.get(address.id)?.confidence ?? 0) >= 0.85);
    }
  });

  test('Townhouse row: over-wide seven-home grouping is not auto-promoted', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'too-wide-row',
      rectangle(-79.00300, 43.00300, -79.00140, 43.00318),
      { primaryStreet: 'Carey Lane' }
    );
    const addresses = ['1', '3', '5', '7', '9', '11', '13'].map((house, index) =>
      makeAddress(house, -79.00288 + index * 0.00022, 43.00322, 'Carey Lane')
    );

    const assignments = service.buildTownhouseRowAssignments(addresses, [building]);

    assertEqual(assignments.size, 0);
  });

  test('Assignment validator keeps one detached address per building unless townhouse evidence is approved', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'detached-large',
      rectangle(-79.00400, 43.00400, -79.00300, 43.00425),
      { primaryStreet: 'Carey Lane' }
    );
    const addresses = ['1', '3', '5', '7', '9', '11', '13'].map((house, index) =>
      makeAddress(house, -79.00390 + index * 0.00012, 43.00410, 'Carey Lane')
    );
    const matches = addresses.map((address) =>
      service.matchAddressToBuilding(address, [building], new Set(), [])
    );

    const validation = service.validateUniqueAddressAssignments(
      matches,
      new Map(addresses.map((address) => [address.id, address])),
      new Map([[building.properties.gers_id, building]])
    );

    assertEqual(validation.matches.length, 1);
    assertEqual(validation.orphans.length, 6);
  });

  await testAsync('Persistence: link upsert failure fails the provision path', async () => {
    const service = createStableLinkerHarness();
    const match = service.matchAddressToBuilding(
      makeAddress('1', -79.00212, 43.00210, 'Carey Lane'),
      [makeBuilding('building-1', rectangle(-79.00220, 43.00200, -79.00180, 43.00230), { primaryStreet: 'Carey Lane' })],
      new Set(),
      []
    );
    const failingSupabase = {
      from(table: string) {
        return {
          upsert() {
            return Promise.resolve({
              data: null,
              error: table === 'building_address_links' ? { message: 'write failed' } : null,
            });
          },
        };
      },
    };
    const failingService = new StableLinkerService(failingSupabase as unknown as SupabaseLike) as unknown as StableLinkerHarness;
    let thrown: unknown = null;

    try {
      await failingService.saveMatches('campaign-1', [match], 'test-release', 'silver');
    } catch (error) {
      thrown = error;
    }

    assertTrue(thrown instanceof Error);
    assertTrue((thrown as Error).message.includes('Failed to save building address links'));
  });

  await testAsync('Gold persistence: non-UUID building ids are stored as public ids only', async () => {
    const state: MockState = {
      campaignAddresses: [
        {
          id: 'address-1',
          campaign_id: 'campaign-1',
          building_id: '550e8400-e29b-41d4-a716-446655440000',
          building_gers_id: null,
        },
      ],
      buildingAddressLinks: [],
    };
    const service = new StableLinkerService(createMockSupabase(state) as unknown as SupabaseLike) as unknown as StableLinkerHarness;
    const match: MatchResult = {
      addressId: 'address-1',
      addressGersId: null,
      buildingId: 'durham_buildings:170090',
      matchType: 'containment_verified',
      confidence: 1,
      distanceMeters: 0,
      streetMatchScore: 1,
      buildingAreaSqm: 120,
      buildingClass: 'residential',
      buildingHeight: null,
      isMultiUnit: false,
      unitCount: 1,
      unitArrangement: 'single',
    };

    await service.saveMatches('campaign-1', [match], 'test-release', 'gold');

    assertEqual(state.campaignAddresses?.[0].building_id, null);
    assertEqual(state.campaignAddresses?.[0].building_gers_id, 'durham_buildings:170090');
    assertEqual(state.buildingAddressLinks?.[0].building_id, 'durham_buildings:170090');
  });

  test('Detached fallback: weak proximity does not reuse an already matched building', () => {
    const service = createStableLinkerHarness();
    const alreadyMatched = makeBuilding(
      'detached-a',
      rectangle(-79.00420, 43.00400, -79.00405, 43.00415)
    );
    const unusedNeighbor = makeBuilding(
      'detached-b',
      rectangle(-79.00455, 43.00400, -79.00440, 43.00415)
    );
    const address = makeAddress('41', -79.00418, 43.00430, 'Moyse Drive');

    const match = service.matchAddressToBuilding(
      address,
      [alreadyMatched, unusedNeighbor],
      new Set(['detached-a']),
      []
    );

    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'detached-b');
  });

  test('Detached fallback: verified proximity does not reuse an already matched building', () => {
    const service = createStableLinkerHarness();
    const alreadyMatched = makeBuilding(
      'detached-a',
      rectangle(-79.00420, 43.00400, -79.00405, 43.00415),
      { primaryStreet: 'Highland Avenue' }
    );
    const unusedNeighbor = makeBuilding(
      'detached-b',
      rectangle(-79.00455, 43.00400, -79.00440, 43.00415),
      { primaryStreet: 'Highland Avenue' }
    );
    const address = makeAddress('324', -79.00418, 43.00430, 'Highland Avenue');

    const match = service.matchAddressToBuilding(
      address,
      [alreadyMatched, unusedNeighbor],
      new Set(['detached-a']),
      []
    );

    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'detached-b');
  });

  test('Nearby same-street address: loose proximity past 30m becomes orphan', () => {
    const service = new StableLinkerService({} as any);
    const building = makeBuilding(
      'nearby-home',
      rectangle(-79.01010, 43.01000, -79.00990, 43.01020),
      { primaryStreet: 'Maple Street' }
    );
    const address = makeAddress('600', -79.00920, 43.01010, 'Maple Street');

    const match = (service as any).matchAddressToBuilding(
      address,
      [building],
      new Set(),
      []
    );

    assertEqual(match.matchType, 'orphan');
  });

  test('Right-outside footprint address: footprint distance links even when centroid is far', () => {
    const service = new StableLinkerService({} as any);
    const building = makeBuilding(
      'wide-building',
      rectangle(-79.03400, 43.03000, -79.03000, 43.03100),
      { primaryStreet: 'Long Hall Road' }
    );
    const address = makeAddress('601', -79.02994, 43.03050, 'Long Hall Road');

    const match = (service as any).matchAddressToBuilding(
      address,
      [building],
      new Set(),
      []
    );

    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'wide-building');
    assertTrue(match.distanceMeters < 10, 'Expected footprint distance under 10m');
  });

  test('Right-outside footprint address: no street metadata still links by geometry', () => {
    const service = new StableLinkerService({} as any);
    const building = makeBuilding(
      'no-street-building',
      rectangle(-79.04020, 43.04000, -79.04000, 43.04020)
    );
    const address = makeAddress('601b', -79.03994, 43.04010, '');

    const match = (service as any).matchAddressToBuilding(
      address,
      [building],
      new Set(),
      []
    );

    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'no-street-building');
    assertTrue(match.distanceMeters < 10, 'Expected footprint distance under 10m');
    assertTrue(match.confidence >= 0.8, 'Expected high confidence from geometry alone');
  });

  test('Nearby fallback address: relaxed fallback past 45m becomes orphan', () => {
    const service = new StableLinkerService({} as any);
    const building = makeBuilding(
      'fallback-home',
      rectangle(-79.02010, 43.02000, -79.01990, 43.02020)
    );
    const address = makeAddress('602', -79.01860, 43.02010, 'Fallback Road');

    const match = (service as any).matchAddressToBuilding(
      address,
      [building],
      new Set(),
      []
    );

    assertEqual(match.matchType, 'orphan');
  });

  test('Detached fallback: weak proximity becomes orphan when every candidate is already matched', () => {
    const service = createStableLinkerHarness();
    const alreadyMatched = makeBuilding(
      'detached-only',
      rectangle(-79.00420, 43.00400, -79.00405, 43.00415)
    );
    const address = makeAddress('43', -79.00418, 43.00430, 'Moyse Drive');

    const match = service.matchAddressToBuilding(
      address,
      [alreadyMatched],
      new Set(['detached-only']),
      []
    );

    assertEqual(match.matchType, 'orphan');
  });

  test('Dense ambiguity: equal-distance buildings raise DataIntegrityError instead of guessing', () => {
    const service = createStableLinkerHarness();
    const left = makeBuilding(
      'left',
      rectangle(-79.00312, 43.00300, -79.00292, 43.00312),
      { primaryStreet: 'Queen Street' }
    );
    const right = makeBuilding(
      'right',
      rectangle(-79.00308, 43.00298, -79.00288, 43.00310),
      { primaryStreet: 'Queen Street' }
    );
    const address = makeAddress('500', -79.00300, 43.00305, 'Queen Street');

    let thrown: unknown = null;
    try {
      service.matchAddressToBuilding(address, [left, right], new Set(), []);
    } catch (error) {
      thrown = error;
    }

    assertTrue(thrown instanceof DataIntegrityError, 'Expected DataIntegrityError for ambiguous proximity tie');
  });

  await testAsync('Orphan/manual assignment: manual assign updates orphan state and inserts manual link', async () => {
    const state: MockState = {
      addressOrphans: [
        {
          id: 'orphan-1',
          campaign_id: 'campaign-1',
          address_id: 'address-1',
          status: 'pending_review',
        },
      ],
      buildingAddressLinks: [],
    };
    const supabase = createMockSupabase(state);
    const service = new StableLinkerService(supabase as unknown as SupabaseLike) as unknown as StableLinkerHarness;

    const orphanMatch = service.matchAddressToBuilding(
      makeAddress('address-1', -79.1000, 43.1000, 'No Match Road'),
      [],
      new Set(),
      []
    );
    assertEqual(orphanMatch.matchType, 'orphan');

    await service.assignOrphan('orphan-1', 'building-77', 'user-1');

    assertEqual(state.addressOrphans?.[0].status, 'assigned');
    assertEqual(state.addressOrphans?.[0].assigned_building_id, 'building-77');
    assertEqual(state.buildingAddressLinks?.length, 1);
    assertEqual(state.buildingAddressLinks?.[0].match_type, 'manual');
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);
  console.log(`${'='.repeat(50)}`);
  if (testsFailed > 0) process.exit(1);
}

void run();
