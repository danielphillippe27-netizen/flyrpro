import { compositeHailSample } from '../intensity/hail-zone';
import { hailSamplingBounds } from '../intensity/hail-zone';
import assert from 'node:assert/strict';
import { dateWindow, campaignStormSchema, visibleEventFeatures } from '../intelligence/model';
import { reportEvents, cycloneEvent } from '../intelligence/normalize';
assert.throws(()=>dateWindow('2026-02-30','2026-03-01'));
assert.throws(()=>dateWindow('2026-01-01','2026-02-01'));
assert.throws(()=>dateWindow('2026-10-02','2026-10-01'));
assert.equal(dateWindow('2024-02-29','2024-02-29').end,'2024-03-01T00:00:00.000Z');
const report=(time:string,lon:number,size:number)=>({type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[lon,40]},properties:{valid:time,typetext:'HAIL',state:'OH',magnitude:size,city:'Test',product_id:'one',remark:'Reported'}});
const events=reportEvents({type:'FeatureCollection',features:[report('2024-10-01T12:00:00Z',-83,2),report('2024-10-01T12:00:00Z',-83,2),report('2024-10-02T00:00:00Z',-83,3),report('2024-10-01T13:00:00Z',-120,4)]},[-90,35,-75,45],'2024-10-01T00:00:00Z','2024-10-02T00:00:00Z','hail');
assert.equal(events.length,1);assert.equal(events[0].reportCount,1);assert.equal(events[0].maxHailMM,50.8);assert.equal(events[0].footprintStatus,'unavailable');
assert.equal(visibleEventFeatures(events[0],51).length,0);
const reference={key:events[0].key,title:events[0].title,hazard:'hail',source:'iem',start:events[0].start,end:events[0].end,sourceId:events[0].sourceId};
assert.equal(campaignStormSchema.safeParse({version:1,event:reference,selectedAt:'2026-10-10T12:00:00Z',minimumHailMM:25.4,selection:'user-drawn',evidenceKind:'reports'}).success,true);
assert.equal(campaignStormSchema.safeParse({version:1,event:reference,selectedAt:'2026-10-10T12:00:00Z',minimumHailMM:25.4,selection:'confirmed-damage',evidenceKind:'reports'}).success,false);
const cyclone=cycloneEvent({id:'2024-AL-14',profile:{name:'Milton',year:2024,isActive:false,maxStormCat:'H5',windSpeed:{maxKPH:290},lifespan:{startDateTimeISO:'2024-10-05T00:00:00Z',endDateTimeISO:'2024-10-10T00:00:00Z'}},track:[{loc:{long:179,lat:20},dateTimeISO:'2024-10-05T00:00:00Z'},{loc:{long:-179,lat:21},dateTimeISO:'2024-10-06T00:00:00Z'},{loc:{long:-178,lat:22},dateTimeISO:'2024-10-07T00:00:00Z'}]});
assert.equal(cyclone.maxWindKPH,290);assert.equal(cyclone.category,'H5');assert.equal(cyclone.features.filter(f=>f.geometry.type==='LineString').length,1);
assert.equal(cyclone.features.some(f=>f.geometry.type==='Polygon'),false);
console.log('Storm Intelligence: calendar boundaries, UTC filtering, spatial filtering, report deduplication, hail units, provenance validation and date-line tracks passed');

// Tight camera zoom must not clip numerical hail selection to the phone viewport.

const localHailBounds = hailSamplingBounds([-110.01, 34.99, -109.99, 35.01], [-110, 35]);
assert(localHailBounds[3] - localHailBounds[1] >= 1.08 - 1e-9);
assert(Math.abs((localHailBounds[0] + localHailBounds[2]) / 2 + 110) < 1e-9);
assert(Math.abs((localHailBounds[1] + localHailBounds[3]) / 2 - 35) < 1e-9);

assert.equal(compositeHailSample([null, {value: 50.8, unit: 'mm', nodata: false}]), 50.8, 'One regional source must not wait for an absent regional source');
assert.equal(compositeHailSample([{value: 1, unit: 'in', nodata: false}, {value: 38.1, unit: 'mm', nodata: false}]), 38.1);
assert.equal(compositeHailSample([null, {value: -999, nodata: true}]), null, 'A loaded transparent pixel ends the swath');
assert.equal(compositeHailSample([null, undefined]), undefined, 'Missing tiles remain pending rather than becoming empty pixels');
