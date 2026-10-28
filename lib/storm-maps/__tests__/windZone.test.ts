import assert from 'node:assert/strict';
import sharp from 'sharp';
import { booleanPointInPolygon, point } from '@turf/turf';
import { traceWindZone, windGridCell, windGridPoint, archivedWindZone } from '../intelligence/wind-zone';
import { WIND_ENCODING, WIND_DATASET, type WindArchiveBundle } from '../intelligence/wind-archive-format';
import { campaignStormSchema } from '../intelligence/model';
import { stormTerritorySchema } from '../intelligence/storm-territories';
async function fixture(cells:[number,number,number][],country:WindArchiveBundle['country']='CA'){
 const tiles=new Map<string,Buffer>();
 for(const [x,y,value]of cells){const key=`4/${Math.floor(x/512)}/${Math.floor(y/512)}`;if(!tiles.has(key))tiles.set(key,Buffer.alloc(512*512*4));const tile=tiles.get(key)!;const i=((y%512)*512+x%512)*4;tile[i]=value;tile[i+3]=255;}
 // Surround measured pockets with calm cells, including across tile seams.
 for(const tile of tiles.values())for(let i=0;i<tile.length;i+=4)if(!tile[i]){tile[i]=1;tile[i+3]=255;}
 const numericTiles:Record<string,string>={};for(const[key,bytes]of tiles)numericTiles[key]=(await sharp(bytes,{raw:{width:512,height:512,channels:4}}).png().toBuffer()).toString('base64');
 return {version:1,country,time:'2026-10-24T12:00:00.000Z',dataset:WIND_DATASET,evidence:'gridded-wind-estimate',zoom:4,tileSize:512,encoding:WIND_ENCODING,numericTiles,displayTiles:{}} as WindArchiveBundle;
}
async function main(){
 const [x,y]=windGridCell(-100,50), center=windGridPoint(x+.5,y+.5);
 const cells:[number,number,number][]=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)cells.push([x+dx,y+dy,80]);
 cells.push([x,y,100],[x+5,y,80]);
 const bundle=await fixture(cells);
 const band=await traceWindZone(bundle,...windGridPoint(x+1.5,y+.5));
 assert.equal(band.minimumKPH,93.341952);assert.equal(band.maximumKPH,120);
 assert.equal(band.boundary.type,'Polygon');assert.equal(band.boundary.coordinates.length,2,'stronger center remains a hole');
 assert(!booleanPointInPolygon(point(center),band.boundary));
 assert(!booleanPointInPolygon(point(windGridPoint(x+5.5,y+.5)),band.boundary),'disconnected pocket excluded');
 const stronger=await traceWindZone(bundle,...windGridPoint(x+1.5,y+.5),93.341952,false);
 assert(booleanPointInPolygon(point(center),stronger.boundary),'include stronger gusts');
 await assert.rejects(()=>traceWindZone(bundle,...center,160),/selected wind range/);
 await assert.rejects(()=>traceWindZone(bundle,...windGridPoint(x+10.5,y+.5)),/at least 40/);
 // Native tile seam connectivity at 1024 crosses from x tile 1 into tile 2 in Canada.
 const seam=await fixture([[2047,y,80],[2048,y,80]]);
 const joined=await traceWindZone(seam,...windGridPoint(2047.5,y+.5));
 assert(booleanPointInPolygon(point(windGridPoint(2048.5,y+.5)),joined.boundary));
 const context={version:2,event:{key:'test',title:'Wind',hazard:'wind',source:'xweather',sourceId:'conditions_GUST_10-HTGL',start:bundle.time,end:bundle.time},selectedAt:bundle.time,minimumHailMM:null,selection:'intensity-zone',evidenceKind:'wind-sampled',gustSelection:{country:'CA',time:bundle.time,longitude:center[0],latitude:center[1],minimumKPH:93.341952,maximumKPH:120,method:'archived-native-grid'}};
 assert(campaignStormSchema.safeParse(context).success);
 assert(stormTerritorySchema.safeParse({name:'Wind pocket',boundary:band.boundary,context}).success);
 assert(!campaignStormSchema.safeParse({...context,evidenceKind:'user-drawn',selection:'user-drawn'}).success);
 assert(!campaignStormSchema.safeParse({...context,gustSelection:undefined}).success);
 assert(!campaignStormSchema.safeParse({...context,event:{...context.event,hazard:'hail'}}).success);
 assert(!campaignStormSchema.safeParse({...context,event:{...context.event,start:'2026-10-24T11:00:00.000Z'}}).success);
 assert.equal(typeof archivedWindZone,'function');
 console.log('Wind zone selection: connected cells, holes, tile seams, thresholds and campaign provenance passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
