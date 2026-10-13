import assert from 'node:assert/strict';
import { booleanPointInPolygon,point } from '@turf/turf';
import { territoryFromHailGrid } from '../intensity/numerical-grid';
const width=9,height=9,values=Array(width*height).fill(0);
for(let y=2;y<=6;y++)for(let x=2;x<=6;x++)values[y*width+x]=30;
values[4*width+4]=0; // a hole
values[2*width+2]=50;values[2*width+6]=70; // separate strong cells
const grid={provider:'xweather',datasetId:'synthetic-fixture',validFrom:'2026-10-09T00:00:00Z',validTo:'2026-10-10T00:00:00Z',sourceUpdatedAt:'2026-10-10T01:00:00Z',units:'mm',crs:'EPSG:4326',layout:'south-to-north-row-major',width,height,bounds:[[-95,41],[-94.91,41.09]],resolutionMeters:1000,values};
const low=territoryFromHailGrid(grid,[-94.975,41.025],25.4);
assert.equal(low.cellCount,24);assert.equal(low.provenance.datasetId,'synthetic-fixture');
assert.equal(booleanPointInPolygon(point([-94.955,41.045]),low.boundary),false);
const high=territoryFromHailGrid(grid,[-94.975,41.025],44.45);assert.equal(high.cellCount,1);
assert.throws(()=>territoryFromHailGrid(grid,[-94.975,41.025],63.5));
const unknown=[...values];unknown[1*width+2]=null;
assert.throws(()=>territoryFromHailGrid({...grid,values:unknown},[-94.975,41.025],25.4),/Unknown/);
const clipped=[...values];clipped[1*width+2]=30;clipped[2]=30;
assert.throws(()=>territoryFromHailGrid({...grid,values:clipped},[-94.975,41.025],25.4),/extends beyond/);
assert.throws(()=>territoryFromHailGrid({...grid,units:'in'},[-94.975,41.025],25.4));
assert.throws(()=>territoryFromHailGrid(grid,[-90,40],25.4));
console.log('Numerical grid: cumulative thresholds, disconnected stronger zones, holes, no-data, clipped edges, units and bounds passed');
