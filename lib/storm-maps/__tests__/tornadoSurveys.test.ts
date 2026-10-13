import assert from 'node:assert/strict';
import { efRating,tornadoSurveyEvents,loadTornadoSurveys } from '../intelligence/tornado-surveys';
import { campaignStormSchema,referenceOf,eventBounds } from '../intelligence/model';
const start='2024-05-01T00:00:00Z',end='2024-05-02T00:00:00Z';
const guid='{008959E4-DD96-43AA-9210-0304BA0942E7}';
const track:GeoJSON.Feature={type:'Feature',geometry:{type:'LineString',coordinates:[[-99,35],[-98.9,35.1]]},properties:{globalid:guid,stormdate:Date.parse(start)+3600000,objectid:1,event_id:'Test',efscale:'EF2'}};
const area:GeoJSON.Feature={type:'Feature',geometry:{type:'Polygon',coordinates:[[[-99,35],[-98.9,35],[-98.9,35.1],[-99,35]]]},properties:{path_guid:guid,globalid:'{C3700299-882E-4CEB-8DA8-C403F7F40424}',stormdate:Date.parse(start)+3600000,objectid:2,event_id:'Test',efscale:'EF1'}};
assert.equal(efRating('EF0'),'EF0');assert.equal(efRating('UNKNOWN'),null);assert.equal(efRating('-99'),null);assert.equal(efRating('EF6'),null);
const events=tornadoSurveyEvents({type:'FeatureCollection',features:[track,area,{...track,properties:{...track.properties,stormdate:Date.parse(end)}}]},start,end);
assert.equal(events.length,1);assert.equal(events[0].features.length,2);assert.equal(events[0].category,'EF2');assert.equal(events[0].footprintStatus,'surveyed');assert.deepEqual(eventBounds(events[0]),[-99,35,-98.9,35.1]);
const context={version:2,event:referenceOf(events[0]),selectedAt:start,minimumHailMM:null,selection:'intensity-zone',evidenceKind:'tornado-survey',surveySelection:{method:'noaa-dat-polygon',featureIds:['dat:area:2'],preliminary:true}};
assert.equal(campaignStormSchema.safeParse(context).success,true);
assert.equal(tornadoSurveyEvents({type:'FeatureCollection',features:[{...track,properties:{...track.properties,efscale:'UNKNOWN'}}]},start,end)[0].category,null);
console.log('NOAA survey identity, UTC filtering, EF0/unknown ratings, polygon provenance and bounds passed');
async function liveCheck(){
if(process.argv.includes('--live')){
 const live=await loadTornadoSurveys([-105,30,-90,40],start,end);
 assert.ok(live.length>0);assert.ok(live.some(event=>event.features.some(f=>f.properties.kind==='track')));
 console.log(`Live NOAA query passed: ${live.length} survey events, ${live.filter(e=>e.category).length} rated, ${live.filter(e=>e.footprintStatus==='surveyed').length} with polygons`);
}

}
liveCheck().catch(error=>{console.error(error);process.exitCode=1;});
