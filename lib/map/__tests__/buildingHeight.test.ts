import assert from 'node:assert/strict';
import {
  DEFAULT_BUILDING_EXTRUSION_HEIGHT_METERS,
  MAXIMUM_BUILDING_EXTRUSION_HEIGHT_METERS,
  MINIMUM_BUILDING_EXTRUSION_HEIGHT_METERS,
  sanitizeBuildingExtrusionHeightMeters,
  usesAbsoluteBuildingElevation,
} from '../buildingHeight';

assert.equal(
  sanitizeBuildingExtrusionHeightMeters({
    source: 'niagara_buildings',
    building_type: 'BuildingsElev',
    height: 205.34,
    height_m: 205.34,
  }),
  DEFAULT_BUILDING_EXTRUSION_HEIGHT_METERS,
  'Niagara roof elevations must not be rendered as building heights'
);

assert.equal(
  usesAbsoluteBuildingElevation({ building_type: 'Buildings Elev' }),
  true,
  'elevation layer names are recognized after normalization'
);

assert.equal(
  sanitizeBuildingExtrusionHeightMeters({ source: 'overture', height_m: 205.34 }),
  205.34,
  'legitimate high-rise heights remain intact'
);

assert.equal(
  sanitizeBuildingExtrusionHeightMeters({ height_m: MAXIMUM_BUILDING_EXTRUSION_HEIGHT_METERS + 1 }),
  DEFAULT_BUILDING_EXTRUSION_HEIGHT_METERS,
  'extreme heights fall back safely'
);

assert.equal(
  sanitizeBuildingExtrusionHeightMeters({ height_m: 2.4 }),
  MINIMUM_BUILDING_EXTRUSION_HEIGHT_METERS,
  'very short structures retain the existing render minimum'
);

assert.equal(
  sanitizeBuildingExtrusionHeightMeters({ height_m: null, height: '8.5' }),
  8.5,
  'a valid alternate height field is accepted'
);

assert.equal(
  sanitizeBuildingExtrusionHeightMeters({ height_m: 'not-a-number' }),
  DEFAULT_BUILDING_EXTRUSION_HEIGHT_METERS,
  'invalid heights fall back safely'
);

console.log('building height guards passed');
