/**
 * StableLinkerService regression fixtures
 *
 * Run with: npx tsx lib/services/__tests__/StableLinkerService.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { StableLinkerService, type MatchResult } from '../StableLinkerService';
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
  options: {
    primaryStreet?: string | null;
    streetName?: string | null;
    name?: string | null;
    source?: string | null;
    featureType?: string | null;
    featureStatus?: string | null;
    houseNumber?: string | null;
    unitsCount?: number | null;
    addressCount?: number | null;
  } = {}
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
      source: options.source ?? null,
      feature_type: options.featureType ?? null,
      feature_status: options.featureStatus ?? null,
      house_number: options.houseNumber ?? null,
      units_count: options.unitsCount ?? null,
      address_count: options.addressCount ?? null,
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

function makeParcel(id: string, ring: number[][]) {
  return {
    type: 'Feature' as const,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [ring],
    },
    properties: {
      id,
      parcel_id: id,
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
  filterValidBuildings(buildings: BuildingFixture[]): BuildingFixture[];
  prepareParcels(parcels: ParcelFixture[]): unknown[];
  matchAddressToBuilding(
    address: AddressFixture,
    buildings: BuildingFixture[],
    parcels?: unknown[],
    claimedSingleUnitBuildingIds?: Set<string>,
    inferredMultiAddressBuildingIds?: Set<string>
  ): MatchResult;
  inferMultiAddressBuildingIds(
    addresses: AddressFixture[],
    buildings: BuildingFixture[],
    parcels: unknown[]
  ): Set<string>;
  saveMatches(
    campaignId: string,
    matches: MatchResult[],
    overtureRelease: string,
    persistenceMode: 'silver' | 'gold'
  ): Promise<void>;
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

    const match = service.matchAddressToBuilding(address, [building]);
    assertEqual(match.matchType, 'containment_verified');
    assertEqual(match.buildingId, 'building-1');
  });

  test('Canonical proximity: same-street address outside footprint links nearby building', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'building-2',
      rectangle(-79.00020, 43.00000, -79.00005, 43.00018),
      { primaryStreet: 'Oak Avenue' }
    );
    const address = makeAddress('200', -78.99998, 43.00016, 'Oak Avenue');

    const match = service.matchAddressToBuilding(address, [building]);
    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'building-2');
  });

  test('Footprint grace: building with no street metadata can link a just-outside street address', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'building-3',
      rectangle(-79.00120, 43.00100, -79.00105, 43.00118)
    );
    const address = makeAddress('300', -79.00098, 43.00110, 'Pine Road');

    const match = service.matchAddressToBuilding(address, [building]);
    assertEqual(match.matchType, 'point_on_surface');
    assertEqual(match.buildingId, 'building-3');
  });

  test('Canonical proximity: same-street distance can reach the 45m band', () => {
    const service = createStableLinkerHarness();
    const building = makeBuilding(
      'building-45m-band',
      rectangle(-79.00620, 43.00600, -79.00600, 43.00620),
      { primaryStreet: 'Band Road' }
    );
    const address = makeAddress('304', -79.00558, 43.00610, 'Band Road');

    const match = service.matchAddressToBuilding(address, [building]);

    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'building-45m-band');
    assertTrue(match.distanceMeters > 30, 'Expected fixture to sit beyond the old 30m limit');
    assertTrue(match.distanceMeters <= 45, 'Expected fixture to sit inside the former 45m distance limit');
  });

  test('Canonical building filter removes tiny/proxy footprints and keeps manual exceptions', () => {
    const service = createStableLinkerHarness();
    const smallBuilding = makeBuilding(
      'small-building',
      rectangle(-79.00600, 43.00600, -79.00596, 43.00604)
    );
    const largeBuilding = makeBuilding(
      'large-building',
      rectangle(-79.00640, 43.00600, -79.00610, 43.00630)
    );
    const proxyBuilding = makeBuilding(
      'address-proxy-address-1',
      rectangle(-79.00680, 43.00600, -79.00650, 43.00630),
      { source: 'address_proxy', featureType: 'address_proxy' }
    );
    const manualTinyBuilding = makeBuilding(
      'manual-tiny',
      rectangle(-79.00700, 43.00600, -79.00696, 43.00604),
      { source: 'manual' }
    );

    const filtered = service.filterValidBuildings([
      smallBuilding,
      largeBuilding,
      proxyBuilding,
      manualTinyBuilding,
    ]);

    assertEqual(filtered.map((building) => building.properties.gers_id), ['large-building', 'manual-tiny']);
  });

  test('Canonical parcel bridge: parcel evidence beats a closer boundary neighbor', () => {
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
    const address = makeAddress('302', -79.00978, 43.01010, 'Cedar Court');
    const parcels = (service as any).prepareParcels([
      makeParcel(
        'parcel-1',
        rectangle(-79.00979, 43.01000, -79.00945, 43.01020)
      ),
    ]);

    const match = (service as any).matchAddressToBuilding(
      address,
      [parcelBuilding, boundaryNeighbor],
      parcels
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

  await testAsync('Persistence: link upsert failure fails the provision path', async () => {
    const service = createStableLinkerHarness();
    const match = service.matchAddressToBuilding(
      makeAddress('1', -79.00212, 43.00210, 'Carey Lane'),
      [makeBuilding('building-1', rectangle(-79.00220, 43.00200, -79.00180, 43.00230), { primaryStreet: 'Carey Lane' })]
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

  test('Canonical linker skips a claimed single-unit building for the next address', () => {
    const service = createStableLinkerHarness();
    const alreadyMatched = makeBuilding(
      'detached-a',
      rectangle(-79.00420, 43.00400, -79.00405, 43.00415),
      { primaryStreet: 'Moyse Drive' }
    );
    const unusedNeighbor = makeBuilding(
      'detached-b',
      rectangle(-79.00455, 43.00400, -79.00440, 43.00415),
      { primaryStreet: 'Moyse Drive' }
    );
    const address = makeAddress('41', -79.00442, 43.00418, 'Moyse Drive');

    const match = service.matchAddressToBuilding(
      address,
      [alreadyMatched, unusedNeighbor],
      [],
      new Set(['detached-a'])
    );

    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'detached-b');
  });

  test('Canonical linker allows multiple addresses for townhouse/multi-unit buildings', () => {
    const service = createStableLinkerHarness();
    const alreadyMatched = makeBuilding(
      'detached-a',
      rectangle(-79.00420, 43.00400, -79.00405, 43.00415),
      { primaryStreet: 'Highland Avenue', unitsCount: 2 }
    );
    const address = makeAddress('324', -79.00418, 43.00430, 'Highland Avenue');

    const match = service.matchAddressToBuilding(
      address,
      [alreadyMatched],
      [],
      new Set(['detached-a'])
    );

    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'detached-a');
  });

  test('Canonical linker infers multi-address row buildings from parcel bridge evidence', () => {
    const service = createStableLinkerHarness();
    const rowBuilding = makeBuilding(
      'fewster-row',
      rectangle(-79.00540, 43.00500, -79.00440, 43.00518),
      { primaryStreet: 'Fewster Street' }
    );
    const addresses = [
      makeAddress('10', -79.00532, 43.00528, 'Fewster Street'),
      makeAddress('12', -79.00512, 43.00528, 'Fewster Street'),
    ];
    const parcels = service.prepareParcels([
      makeParcel('parcel-10', rectangle(-79.00536, 43.00518, -79.00518, 43.00534)),
      makeParcel('parcel-12', rectangle(-79.00516, 43.00518, -79.00498, 43.00534)),
    ]);
    const inferred = service.inferMultiAddressBuildingIds(addresses, [rowBuilding], parcels);

    assertTrue(inferred.has('fewster-row'), 'Expected row building to accept multiple linked addresses');

    const claimed = new Set(['fewster-row']);
    const secondMatch = service.matchAddressToBuilding(
      addresses[1],
      [rowBuilding],
      parcels,
      claimed,
      inferred
    );

    assertEqual(secondMatch.matchType, 'parcel_verified');
    assertEqual(secondMatch.buildingId, 'fewster-row');
  });

  test('Canonical linker infers same-street nearby-only row buildings for townhouse cards', () => {
    const service = createStableLinkerHarness();
    const rowBuilding = makeBuilding(
      'moyse-row',
      rectangle(-79.00600, 43.00600, -79.00580, 43.00612)
    );
    const addresses = [
      makeAddress('45', -79.00590, 43.00620, 'Moyse Drive'),
      makeAddress('47', -79.00584, 43.00621, 'Moyse Drive'),
    ];
    const inferred = service.inferMultiAddressBuildingIds(addresses, [rowBuilding], []);

    assertTrue(inferred.has('moyse-row'), 'Expected same-street nearby addresses to mark a row building as multi-address');

    const match = service.matchAddressToBuilding(
      addresses[1],
      [rowBuilding],
      [],
      new Set(['moyse-row']),
      inferred
    );

    assertEqual(match.matchType, 'proximity_fallback');
    assertEqual(match.buildingId, 'moyse-row');
  });

  test('Nearby same-street address: distance past 45m still links when footprint is large', () => {
    const service = new StableLinkerService({} as any);
    const building = makeBuilding(
      'nearby-home',
      rectangle(-79.01010, 43.01000, -79.00990, 43.01020),
      { primaryStreet: 'Maple Street' }
    );
    const address = makeAddress('600', -79.00920, 43.01010, 'Maple Street');

    const match = (service as any).matchAddressToBuilding(
      address,
      [building]
    );

    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'nearby-home');
    assertTrue(match.distanceMeters > 45, 'Expected fixture to sit beyond 45m');
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
      [building]
    );

    assertEqual(match.matchType, 'proximity_verified');
    assertEqual(match.buildingId, 'wide-building');
    assertTrue(match.distanceMeters < 10, 'Expected footprint distance under 10m');
  });

  test('Right-outside footprint address: no usable street signal stays orphan', () => {
    const service = new StableLinkerService({} as any);
    const building = makeBuilding(
      'no-street-building',
      rectangle(-79.04020, 43.04000, -79.04000, 43.04020)
    );
    const address = makeAddress('601b', -79.03994, 43.04010, '');

    const match = (service as any).matchAddressToBuilding(
      address,
      [building]
    );

    assertEqual(match.matchType, 'orphan');
  });

  test('Nearby different-street address stays orphan without parcel bridge', () => {
    const service = new StableLinkerService({} as any);
    const building = makeBuilding(
      'fallback-home',
      rectangle(-79.02010, 43.02000, -79.01990, 43.02020),
      { primaryStreet: 'Other Road' }
    );
    const address = makeAddress('602', -79.01860, 43.02010, 'Fallback Road');

    const match = (service as any).matchAddressToBuilding(
      address,
      [building]
    );

    assertEqual(match.matchType, 'orphan');
  });

  test('Right-outside different-street address stays orphan without parcel bridge', () => {
    const service = new StableLinkerService({} as any);
    const building = makeBuilding(
      'wrong-street-edge',
      rectangle(-79.02120, 43.02100, -79.02100, 43.02120),
      { primaryStreet: 'Other Road' }
    );
    const address = makeAddress('603', -79.02094, 43.02110, 'Fallback Road');

    const match = (service as any).matchAddressToBuilding(
      address,
      [building]
    );

    assertEqual(match.matchType, 'orphan');
  });

  test('Dense ambiguity: equal-distance retained buildings resolve deterministically', () => {
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

    const match = service.matchAddressToBuilding(address, [left, right]);

    assertEqual(match.matchType, 'containment_verified');
    assertEqual(match.buildingId, 'left');
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
