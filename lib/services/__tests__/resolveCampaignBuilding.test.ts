import assert from 'node:assert/strict';
import {
  buildingIdentifierCandidates,
  isSnapshotBuildingIdentifier,
  normalizeBuildingRouteId,
} from '../../../app/api/campaigns/_utils/resolve-campaign-building';

const overtureId = 'overture:building:9e151a73-9486-4a9f-9ac4-d540e12e3287';

assert.deepEqual(buildingIdentifierCandidates(overtureId), [
  overtureId,
  '9e151a73-9486-4a9f-9ac4-d540e12e3287',
]);

assert.equal(isSnapshotBuildingIdentifier(overtureId), true);
assert.equal(isSnapshotBuildingIdentifier('9e151a73-9486-4a9f-9ac4-d540e12e3287'), true);
assert.equal(isSnapshotBuildingIdentifier(''), false);

assert.equal(
  normalizeBuildingRouteId('overture%3Abuilding%3A9e151a73-9486-4a9f-9ac4-d540e12e3287'),
  overtureId
);
assert.equal(
  normalizeBuildingRouteId(['overture', 'building', '9e151a73-9486-4a9f-9ac4-d540e12e3287']),
  overtureId
);

console.log('resolveCampaignBuilding helper tests passed');
