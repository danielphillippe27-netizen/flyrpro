import assert from 'node:assert/strict';
import { campaignStormSchema, type StormCampaignContext } from '../intelligence/model';
import { normalizeStormDrawingContext } from '../intelligence/storm-territories';
const context: StormCampaignContext = {version:1,event:{key:'manual',title:'Storm inspection area',hazard:'hail',source:'xweather',sourceId:'storm-map-selection',start:'2026-10-13T12:00:00Z',end:'2026-10-13T13:00:00Z'},selectedAt:'2026-10-13T12:30:00Z',minimumHailMM:null,selection:'user-drawn',evidenceKind:'hail-size'};
assert.equal(normalizeStormDrawingContext(context).evidenceKind,'user-drawn');
assert.equal(campaignStormSchema.safeParse(normalizeStormDrawingContext(context)).success,true);
for (const qualified of [{...context,selection:'intensity-zone' as const,minimumHailMM:25.4},{...context,zoneId:'a91b5aa9-a5e5-4b4f-8984-ce189b849938'},{...context,minimumHailMM:25.4},{...context,sampling:{cellMeters:100,clickedMM:25.4,method:'numerical-map-contour' as const}}]) {
 assert.equal(normalizeStormDrawingContext(qualified).evidenceKind,'hail-size','Severity evidence must retain its validation gate');
 assert.equal(campaignStormSchema.safeParse({...qualified,evidenceKind:'user-drawn'}).success,false,'Manual provenance cannot bypass severity validation');
}
assert.equal(context.evidenceKind,'hail-size','Do not mutate input context');
console.log('Manual storm drawing: unqualified inspection areas bypass severity gating; qualified severity claims remain gated');
