/**
 * Run with: npx tsx lib/services/__tests__/CampaignMapReconciliationRules.test.ts
 */
import {
  MAP_RECONCILIATION_ALGORITHM_VERSION,
  addressContextMatchesReverse,
  assessReverseOrphanCorrection,
  buildingAllowsMultipleCivicAddresses,
  buildingHasAuthoritativeMultiUnitMetadata,
  canAutoReassignAddressFromReverseGeocode,
  canAutoCreateSyntheticOnParcel,
  createParcelIdentityResolver,
  canCreateSyntheticAfterGlobalAssignment,
  buildLinkedNeighborhoodEvidence,
  configuredMaxReverseGeocodes,
  configuredReverseGeocodingStorageMode,
  neighborhoodContextForCandidate,
  normalizedCivicAddressIdentity,
  normalizedAddressIdentity,
  isBuildingAvailableForCivicAssignment,
  parseMapboxReverseResult,
  reverseGeocodingConfigurationIssue,
  scoreReconciliationCandidate,
  shouldQueueMapReconciliationConvergencePass,
  shouldReverseGeocodeBuilding,
  solveGlobalOneToOneAssignment,
  shouldAutoHideAuxiliary,
  shouldAutoHideOverlappingDuplicate,
} from '../CampaignMapReconciliationService';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  MAP_RECONCILIATION_ALGORITHM_VERSION.includes('global'),
  'the algorithm version must keep the global dispatcher token for parcel and non-parcel campaigns'
);

assert(
  configuredReverseGeocodingStorageMode('temporary') === 'temporary',
  'temporary testing mode must disable permanent Mapbox storage'
);
assert(
  configuredReverseGeocodingStorageMode('permanent') === 'permanent',
  'permanent storage must remain available only when explicitly configured'
);
assert(
  configuredReverseGeocodingStorageMode(undefined) === 'temporary',
  'temporary Mapbox reverse geocoding must be the safe default'
);
assert(
  configuredMaxReverseGeocodes('') === 1000 &&
    configuredMaxReverseGeocodes('not-a-number') === 1000 &&
    configuredMaxReverseGeocodes('0') === 0,
  'blank or invalid reverse-geocode limits must use the fallback while explicit zero disables calls'
);
assert(
  reverseGeocodingConfigurationIssue({
    unresolvedBuildingCount: 1,
    enabled: false,
    maxGeocodes: 1000,
    hasToken: true,
  })?.includes('ENABLE_REVERSE_GEOCODE') === true &&
    reverseGeocodingConfigurationIssue({
      unresolvedBuildingCount: 1,
      enabled: true,
      maxGeocodes: 0,
      hasToken: true,
    })?.includes('MAX_GEOCODES_PER_RUN') === true &&
    reverseGeocodingConfigurationIssue({
      unresolvedBuildingCount: 1,
      enabled: true,
      maxGeocodes: 1000,
      hasToken: false,
    })?.includes('MAPBOX_TOKEN') === true,
  'an unresolved campaign must fail visibly when reverse geocoding is disabled or misconfigured'
);
assert(
  reverseGeocodingConfigurationIssue({
    unresolvedBuildingCount: 0,
    enabled: false,
    maxGeocodes: 0,
    hasToken: false,
  }) === null,
  'a fully linked campaign must not require reverse-geocoding configuration'
);
assert(
  shouldQueueMapReconciliationConvergencePass({
    mode: 'apply_high_confidence',
    appliedCount: 8,
    buildingOrphansBefore: 49,
    buildingOrphansAfter: 21,
  }) &&
    !shouldQueueMapReconciliationConvergencePass({
      mode: 'apply_high_confidence',
      appliedCount: 0,
      buildingOrphansBefore: 21,
      buildingOrphansAfter: 21,
    }) &&
    !shouldQueueMapReconciliationConvergencePass({
      mode: 'shadow',
      appliedCount: 8,
      buildingOrphansBefore: 49,
      buildingOrphansAfter: 21,
    }),
  'apply mode must continue only while a pass makes measurable orphan progress'
);

const globalAssignment = solveGlobalOneToOneAssignment([
  { buildingId: 'building-a', addressId: 'address-1', weight: 10 },
  { buildingId: 'building-a', addressId: 'address-2', weight: 9 },
  { buildingId: 'building-b', addressId: 'address-1', weight: 8 },
]);
assert(
  globalAssignment.some((pair) =>
    pair.buildingId === 'building-a' && pair.addressId === 'address-2'
  ) &&
    globalAssignment.some((pair) =>
      pair.buildingId === 'building-b' && pair.addressId === 'address-1'
    ),
  'global assignment must preserve maximum cardinality across a reassignment chain'
);
assert(
  canCreateSyntheticAfterGlobalAssignment({
    targetBuildingId: 'building-a',
    currentAddressIds: ['wrong-address'],
    assignments: [{ buildingId: 'building-b', addressId: 'wrong-address' }],
  }),
  'a missing rooftop address may be created when the old occupant moves in the same transaction'
);
assert(
  !canCreateSyntheticAfterGlobalAssignment({
    targetBuildingId: 'building-a',
    currentAddressIds: ['wrong-address'],
    assignments: [],
  }),
  'a missing rooftop address must not create a second occupant on a capacity-one building'
);

assert(
  canAutoCreateSyntheticOnParcel({
    parcelId: 'parcel-1',
    residentialBuildingCountOnParcel: 1,
    knownCivicAddressCountOnParcel: 0,
  }),
  'a single residential footprint on an empty parcel may receive one strong synthetic address'
);
assert(
  !canAutoCreateSyntheticOnParcel({
    parcelId: 'parcel-1',
    residentialBuildingCountOnParcel: 2,
    knownCivicAddressCountOnParcel: 0,
  }),
  'multiple residential footprints on an empty parcel must not each create an inferred address'
);
assert(
  !canAutoCreateSyntheticOnParcel({
    parcelId: 'parcel-1',
    residentialBuildingCountOnParcel: 1,
    knownCivicAddressCountOnParcel: 1,
  }),
  'a parcel with an authoritative civic address must not auto-create a different address'
);
assert(
  canAutoCreateSyntheticOnParcel({
    parcelId: null,
    residentialBuildingCountOnParcel: 4,
    knownCivicAddressCountOnParcel: 0,
  }),
  'parcel-less campaigns retain the established global reverse behavior'
);

const resolveParcelIdentity = createParcelIdentityResolver([{
  type: 'Feature',
  id: 'parcel-feature-1',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-79.701, 43.599],
      [-79.699, 43.599],
      [-79.699, 43.601],
      [-79.701, 43.601],
      [-79.701, 43.599],
    ]],
  },
  properties: { parcel_id: 'parcel-1' },
}]);
assert(
  resolveParcelIdentity({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-79.7002, 43.5998],
        [-79.6998, 43.5998],
        [-79.6998, 43.6002],
        [-79.7002, 43.6002],
        [-79.7002, 43.5998],
      ]],
    },
    properties: { building_id: 'building-without-parcel-property' },
  }) === 'parcel-1',
  'a building without parcel metadata must inherit the smallest containing parcel spatially'
);

const candidateAddress: GeoJSON.Feature<GeoJSON.Point> = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-79.7, 43.6] },
  properties: {
    house_number: '123',
    street_name: 'Example Street',
    locality: 'Mississauga',
    region: 'ON',
    postal_code: 'L5M 1A1',
  },
};
assert(
  addressContextMatchesReverse(candidateAddress, {
    cacheKey: 'temporary',
    formatted: '123 Example Street',
    houseNumber: '123',
    streetName: 'Example Street',
    locality: 'Mississauga',
    region: 'ON',
    postalCode: 'L5M 1A1',
    country: 'CA',
    longitude: -79.7,
    latitude: 43.6,
    accuracy: 'rooftop',
    identity: '123|example street|mississauga|on|l5m1a1',
    raw: {},
  }),
  'reverse postal context must be compared with the candidate address'
);
assert(
  !addressContextMatchesReverse(candidateAddress, {
    cacheKey: 'temporary',
    formatted: '123 Example Street',
    houseNumber: '123',
    streetName: 'Example Street',
    locality: 'Mississauga',
    region: 'ON',
    postalCode: 'L5M 9Z9',
    country: 'CA',
    longitude: -79.7,
    latitude: 43.6,
    accuracy: 'rooftop',
    identity: '123|example street|mississauga|on|l5m9z9',
    raw: {},
  }),
  'a different candidate postal code must reject the reverse match'
);
assert(
  !buildingHasAuthoritativeMultiUnitMetadata({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-79.7, 43.6],
        [-79.6999, 43.6],
        [-79.6999, 43.6001],
        [-79.7, 43.6001],
        [-79.7, 43.6],
      ]],
    },
    properties: {
      address_count: 4,
      inferred_from_nearby_addresses: true,
      building_type: 'detached',
    },
  }),
  'nearby-address counts must not create multi-unit capacity in parcel-less detached mode'
);
assert(
  buildingHasAuthoritativeMultiUnitMetadata({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-79.7, 43.6],
        [-79.6999, 43.6],
        [-79.6999, 43.6001],
        [-79.7, 43.6001],
        [-79.7, 43.6],
      ]],
    },
    properties: { building_type: 'townhouse' },
  }),
  'explicit townhouse metadata must retain multi-unit capacity'
);

const detachedBuildingWithoutUnitMetadata: GeoJSON.Feature<GeoJSON.Polygon> = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-79.7, 43.6],
      [-79.6999, 43.6],
      [-79.6999, 43.6001],
      [-79.7, 43.6001],
      [-79.7, 43.6],
    ]],
  },
  properties: { building_type: 'detached' },
};
assert(
  buildingAllowsMultipleCivicAddresses(detachedBuildingWithoutUnitMetadata, 2),
  'an existing multi-address canonical link set must protect sibling addresses even without unit metadata'
);
assert(
  !buildingAllowsMultipleCivicAddresses(detachedBuildingWithoutUnitMetadata, 1),
  'a single existing address must not manufacture multi-address capacity'
);
assert(
  shouldReverseGeocodeBuilding(false, false, null),
  'an unlinked building must remain eligible for targeted reverse geocoding'
);
assert(
  !shouldReverseGeocodeBuilding(true, false, 0.9),
  'an established linked building must not be reverse geocoded indiscriminately'
);
assert(
  shouldReverseGeocodeBuilding(true, true, 0.5),
  'an orphaned building with only low-confidence evidence may be reverse geocoded'
);
assert(
  !canAutoReassignAddressFromReverseGeocode(0.9) &&
    canAutoReassignAddressFromReverseGeocode(0.5) &&
    canAutoReassignAddressFromReverseGeocode(0.9, 'point_on_surface', 'rooftop') &&
    canAutoReassignAddressFromReverseGeocode(0.9, 'point_on_surface', 'parcel') &&
    !canAutoReassignAddressFromReverseGeocode(0.9, 'nearest', 'rooftop') &&
    !canAutoReassignAddressFromReverseGeocode(0.9, 'point_on_surface', 'point'),
  'only exact rooftop or parcel evidence may override a 0.90 point-on-surface link'
);

const source1777 = normalizedAddressIdentity({
  houseNumber: '1777',
  streetName: 'Willow Way',
  locality: 'Oshawa',
  region: 'ON',
  postalCode: 'L1K 0A1',
});
const reverse1777 = normalizedAddressIdentity({
  houseNumber: '1777',
  streetName: 'Willow Way',
  locality: 'oshawa',
  region: 'Ontario',
  postalCode: 'L1K0A1',
});
const source1799 = normalizedAddressIdentity({
  houseNumber: '1799',
  streetName: 'Willow Way',
  locality: 'Oshawa',
  region: 'ON',
  postalCode: 'L1K 0A1',
});

assert(source1777 !== source1799, '1777 and 1799 must never normalize to the same civic address');
assert(
  source1777 === reverse1777,
  'postal spacing and case must not prevent reuse of the existing 1777 address'
);
assert(
  normalizedAddressIdentity({
    houseNumber: '5819',
    streetName: 'Riverside PL',
    locality: 'MISSISSAUGA',
    region: 'ON',
    postalCode: 'L5M4X1',
  }) === normalizedAddressIdentity({
    houseNumber: '5819',
    streetName: 'Riverside Place',
    locality: 'Mississauga',
    region: 'Ontario',
    postalCode: 'L5M 4X1',
  }),
  'street suffix aliases must prevent duplicate synthetic addresses'
);
assert(
  normalizedCivicAddressIdentity({
    houseNumber: '5564',
    streetName: 'Leisure CRT',
  }) === normalizedCivicAddressIdentity({
    houseNumber: '5564',
    streetName: 'Leisure Court',
  }),
  'an orphan source without locality metadata must still match the same normalized civic address'
);
const mapboxV6CanadianReverse = parseMapboxReverseResult('cache-key', {
  features: [{
    geometry: { type: 'Point', coordinates: [-79.71375, 43.586683] },
    properties: {
      feature_type: 'address',
      full_address: '5819 Riverside Place, Mississauga, Ontario L5M 4X1, Canada',
      coordinates: {
        longitude: -79.71375,
        latitude: 43.586683,
        accuracy: 'rooftop',
      },
      context: {
        address: {
          address_number: '5819',
          street_name: 'Riverside Place',
        },
        postcode: { name: 'L5M 4X1' },
        place: { name: 'Mississauga' },
        region: { name: 'Ontario', region_code: 'ON' },
        country: { name: 'Canada', country_code: 'CA' },
      },
    },
  }],
});
assert(
  mapboxV6CanadianReverse?.houseNumber === '5819' &&
  mapboxV6CanadianReverse.streetName === 'Riverside Place' &&
  mapboxV6CanadianReverse.accuracy === 'rooftop',
  'Mapbox v6 Canadian reverse responses must read civic fields from context.address'
);
const occupiedBy1799 = new Set(['building-1799']);
assert(
  !isBuildingAvailableForCivicAssignment('building-1799', false, occupiedBy1799),
  'the 1777 orphan must not steal the ordinary footprint already occupied by 1799'
);
assert(
  isBuildingAvailableForCivicAssignment('building-1777', false, occupiedBy1799),
  'the unresolved 1777 footprint remains eligible for normalized address reuse'
);
assert(
  normalizedAddressIdentity({
    houseNumber: '1777',
    streetName: 'Willow Way',
    unit: '1',
  }) !== normalizedAddressIdentity({
    houseNumber: '1777',
    streetName: 'Willow Way',
    unit: '2',
  }),
  'distinct apartment or townhouse units must never merge'
);

const linkedAddress1696 = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-79.7001, 43.57996] },
  properties: { address_id: 'address-1696', house_number: '1696', street_name: 'Summergrove CRES' },
} as GeoJSON.Feature<GeoJSON.Point>;
const linkedAddress1700 = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-79.6997, 43.57996] },
  properties: { address_id: 'address-1700', house_number: '1700', street_name: 'Summergrove Crescent' },
} as GeoJSON.Feature<GeoJSON.Point>;
const linkedBuilding1696 = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-79.70014, 43.58008],
      [-79.70006, 43.58008],
      [-79.70006, 43.58016],
      [-79.70014, 43.58016],
      [-79.70014, 43.58008],
    ]],
  },
  properties: { building_id: 'building-1696' },
} as GeoJSON.Feature<GeoJSON.Polygon>;
const linkedBuilding1700 = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-79.69974, 43.58008],
      [-79.69966, 43.58008],
      [-79.69966, 43.58016],
      [-79.69974, 43.58016],
      [-79.69974, 43.58008],
    ]],
  },
  properties: { building_id: 'building-1700' },
} as GeoJSON.Feature<GeoJSON.Polygon>;
const orphanAddress1698 = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-79.6999, 43.57996] },
  properties: { address_id: 'address-1698', house_number: '1698', street_name: 'Summergrove CRES' },
} as GeoJSON.Feature<GeoJSON.Point>;
const candidateBuilding1698 = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-79.69994, 43.58008],
      [-79.69986, 43.58008],
      [-79.69986, 43.58016],
      [-79.69994, 43.58016],
      [-79.69994, 43.58008],
    ]],
  },
  properties: { building_id: 'building-1698' },
} as GeoJSON.Feature<GeoJSON.Polygon>;
const linkedNeighborhood = buildLinkedNeighborhoodEvidence({
  links: [
    { address_id: 'address-1696', building_id: 'building-1696' },
    { address_id: 'address-1700', building_id: 'building-1700' },
  ],
  addressesById: new Map([
    ['address-1696', linkedAddress1696],
    ['address-1700', linkedAddress1700],
  ]),
  buildingsById: new Map([
    ['building-1696', linkedBuilding1696],
    ['building-1700', linkedBuilding1700],
  ]),
});
const sequenceContext = neighborhoodContextForCandidate({
  address: orphanAddress1698,
  building: candidateBuilding1698,
  linkedEvidence: linkedNeighborhood,
});
const sequenceCandidate = scoreReconciliationCandidate(
  orphanAddress1698,
  candidateBuilding1698,
  sequenceContext
);
assert(
  sequenceCandidate.score >= 0.70 &&
  sequenceCandidate.evidence.includes('house_number_sequence'),
  'suburban road-offset points should become review candidates when linked neighbors establish the street and number sequence'
);
assert(
  !sequenceCandidate.evidence.includes('footprint_containment') &&
  !sequenceCandidate.evidence.includes('same_parcel'),
  'sequence-only evidence must remain review-only and must not satisfy automatic-link hard constraints'
);

assert(
  !shouldAutoHideOverlappingDuplicate({
    polygonIou: 0.2,
    centroidDistanceMeters: 12,
    leftParcelId: 'parcel-1',
    rightParcelId: 'parcel-1',
    hasProtectedHistory: false,
  }),
  'two legitimate buildings sharing a reverse-geocode result must remain visible'
);
assert(
  shouldAutoHideOverlappingDuplicate({
    polygonIou: 0.94,
    centroidDistanceMeters: 1.8,
    leftParcelId: 'parcel-1',
    rightParcelId: 'parcel-1',
    hasProtectedHistory: false,
  }),
  'true overlapping duplicates should be reversible hide candidates'
);
assert(
  !shouldAutoHideOverlappingDuplicate({
    polygonIou: 0.99,
    centroidDistanceMeters: 0.4,
    leftParcelId: 'parcel-1',
    rightParcelId: 'parcel-1',
    hasProtectedHistory: true,
  }),
  'protected field history must block duplicate hiding'
);

assert(
  shouldAutoHideAuxiliary({
    explicitNonResidentialType: false,
    areaSquareMeters: 24,
    primaryAreaSquareMeters: 120,
    hasUniqueAddressOrHistory: false,
    duplicateReverseIdentity: true,
    outbuildingPlacement: true,
  }),
  'a small unaddressed outbuilding may be hidden'
);
assert(
  !shouldAutoHideAuxiliary({
    explicitNonResidentialType: false,
    areaSquareMeters: 24,
    primaryAreaSquareMeters: 120,
    hasUniqueAddressOrHistory: true,
    duplicateReverseIdentity: true,
    outbuildingPlacement: true,
  }),
  'an ADU or laneway home with unique history must remain visible'
);

const strongRooftopCorrection = assessReverseOrphanCorrection({
  accuracy: 'rooftop',
  reversePointDistanceMeters: 2.5,
  sourcePointDistanceMeters: 41,
  addressIdentityMatches: true,
  uniqueAddressIdentity: true,
  uniqueBuildingIdentity: true,
  addressIsOrphan: true,
  buildingIsOrphan: true,
  localityMatches: true,
  regionMatches: true,
  postalMatches: true,
  protectedHistory: false,
  explicitNonResidentialType: false,
});
assert(
  strongRooftopCorrection.eligible &&
  strongRooftopCorrection.moveSource &&
  strongRooftopCorrection.score >= 0.99,
  'a unique rooftop-confirmed orphan pair should align source geometry to the building'
);

const jurisdictionLabeledAddress: GeoJSON.Feature<GeoJSON.Point> = {
  ...candidateAddress,
  properties: {
    ...candidateAddress.properties,
    locality: 'Durham',
    postal_code: 'L1C 0P3',
  },
};
assert(
  addressContextMatchesReverse(jurisdictionLabeledAddress, {
    cacheKey: 'temporary',
    formatted: '137 John Matthew Crescent, Bowmanville, ON L1C 0P3',
    houseNumber: '137',
    streetName: 'John Matthew Crescent',
    locality: 'Bowmanville',
    region: 'ON',
    postalCode: 'L1C 0P3',
    country: 'CA',
    longitude: -78.7,
    latitude: 43.9,
    accuracy: 'rooftop',
    identity: '137|john matthew crescent|bowmanville|on|l1c0p3',
    raw: {},
  }),
  'an exact postal and region match must bridge jurisdiction-versus-civic locality labels'
);

assert(
  !assessReverseOrphanCorrection({
    accuracy: 'interpolated',
    reversePointDistanceMeters: 0,
    sourcePointDistanceMeters: 20,
    addressIdentityMatches: true,
    uniqueAddressIdentity: true,
    uniqueBuildingIdentity: true,
    addressIsOrphan: true,
    buildingIsOrphan: true,
    localityMatches: true,
    regionMatches: true,
    postalMatches: true,
    protectedHistory: false,
    explicitNonResidentialType: false,
  }).eligible,
  'interpolated reverse geocodes must never create an automatic link'
);

assert(
  !assessReverseOrphanCorrection({
    accuracy: 'rooftop',
    reversePointDistanceMeters: 1,
    sourcePointDistanceMeters: 25,
    addressIdentityMatches: true,
    uniqueAddressIdentity: false,
    uniqueBuildingIdentity: true,
    addressIsOrphan: true,
    buildingIsOrphan: true,
    localityMatches: true,
    regionMatches: true,
    postalMatches: true,
    protectedHistory: false,
    explicitNonResidentialType: false,
  }).eligible,
  'duplicate orphan address identities must remain unresolved'
);

assert(
  !assessReverseOrphanCorrection({
    accuracy: 'rooftop',
    reversePointDistanceMeters: 1,
    sourcePointDistanceMeters: 25,
    addressIdentityMatches: true,
    uniqueAddressIdentity: true,
    uniqueBuildingIdentity: true,
    addressIsOrphan: true,
    buildingIsOrphan: true,
    localityMatches: true,
    regionMatches: true,
    postalMatches: true,
    protectedHistory: true,
    explicitNonResidentialType: false,
  }).eligible,
  'field history must block automatic reverse-geocode linking'
);

assert(
  !assessReverseOrphanCorrection({
    accuracy: 'parcel',
    reversePointDistanceMeters: 3,
    sourcePointDistanceMeters: 20,
    addressIdentityMatches: true,
    uniqueAddressIdentity: true,
    uniqueBuildingIdentity: true,
    addressIsOrphan: true,
    buildingIsOrphan: true,
    localityMatches: true,
    regionMatches: true,
    postalMatches: true,
    protectedHistory: false,
    explicitNonResidentialType: false,
  }).eligible,
  'parcel accuracy may link only when the provider point is inside the footprint'
);

console.log('✓ map reconciliation rule regression tests passed');
