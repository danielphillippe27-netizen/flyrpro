/**
 * Run with: npx tsx lib/services/__tests__/CampaignMapReconciliationRules.test.ts
 */
import {
  assessReverseOrphanCorrection,
  buildLinkedNeighborhoodEvidence,
  neighborhoodContextForCandidate,
  normalizedCivicAddressIdentity,
  normalizedAddressIdentity,
  isBuildingAvailableForCivicAssignment,
  parseMapboxReverseResult,
  scoreReconciliationCandidate,
  shouldAutoHideAuxiliary,
  shouldAutoHideOverlappingDuplicate,
} from '../CampaignMapReconciliationService';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

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
  'a unique rooftop-confirmed orphan pair should move the campaign source point'
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
  'interpolated reverse geocodes must never move source geometry'
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
  'field history must block source-coordinate movement'
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
  'parcel accuracy may move source geometry only when the provider point is inside the footprint'
);

console.log('✓ map reconciliation rule regression tests passed');
