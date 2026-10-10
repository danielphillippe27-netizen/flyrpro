import { resetStormTimeline } from '../gl-timeline';
import assert from 'node:assert/strict';
import { STRONGEST_STORM_SETTINGS, readStormGLSettings, stormTimeRange, hailViewSettings, isHistoricalHailShade } from '../gl-settings';
import { resolveGLRequest, allowedVectorProducts } from '../gl-proxy-policy';
import { stormTerritoryImpact } from '../gl-impact';
import type { StormFeatureProperties } from '../types';
assert.equal(STRONGEST_STORM_SETTINGS.lightning, true);
assert.equal(STRONGEST_STORM_SETTINGS.hail, true);
assert.equal(STRONGEST_STORM_SETTINGS.cells, true);
assert.equal(STRONGEST_STORM_SETTINGS.inspector, true);
assert.equal(STRONGEST_STORM_SETTINGS.shade, 'none');
assert.equal(STRONGEST_STORM_SETTINGS.radarOpacity, 80);
assert.deepEqual(readStormGLSettings({ ...STRONGEST_STORM_SETTINGS, shade: 'temperatures', radarOpacity: 95 }), STRONGEST_STORM_SETTINGS);
assert.equal(readStormGLSettings({ ...STRONGEST_STORM_SETTINGS, shade: 'temperatures', radarOpacity: 70 }).shade, 'temperatures');
const settings = readStormGLSettings({ hail: false, opacity: 999, radarOpacity: -10, shade: 'bogus', units: 'imperial', historyHours: 24, speed: NaN });
assert.equal(settings.hail, false); assert.equal(settings.opacity,100); assert.equal(settings.radarOpacity,0); assert.equal(settings.shade,'none'); assert.equal(settings.units,'imperial'); assert.equal(settings.speed,12);
assert.deepEqual(readStormGLSettings(null),STRONGEST_STORM_SETTINGS);
const now=1791637200545;
for(const mode of ['live','history','forecast'] as const) { const range=stormTimeRange(mode,24,now); assert.equal(range.current.getTime()%1000,0); assert.ok(range.start<=range.current&&range.current<=range.end); }
assert.equal(stormTimeRange('forecast',24,now).end.getTime()-stormTimeRange('forecast',24,now).start.getTime(),24*3600_000);
assert.equal(resolveGLRequest(['vector','hail-threats-nowcast','2026-10-10T13:00:00.000Z','6','17','23.pbf'],'GET')?.kind,'vector');
assert.equal(resolveGLRequest(['vector','anything','2026-10-10T13:00:00Z','6','17','23.pbf'],'GET'),null);
assert.equal(resolveGLRequest(['maps','wolfgrid_session','stormcells.json'],'GET')?.kind,'maps');
assert.equal(resolveGLRequest(['maps','wolfgrid_session','lightning-flash','6','17','23','20261010130000.pbf'],'GET')?.kind,'maps');
assert.equal(resolveGLRequest(['maps','someone_else','stormcells.json'],'GET'),null);
assert.equal(resolveGLRequest(['maps','wolfgrid_session','../../evil.json'],'GET'),null);
assert.equal(resolveGLRequest(['tile','6','17','23','512x512','2026-10-10T13:00:00.000Z.png'],'POST')?.kind,'image');
assert.equal(resolveGLRequest(['tile','6','17','23','512x512','2026-10-10T13:00:00.000Z.png'],'GET'),null);
assert.equal(allowedVectorProducts(['hail-threats-nowcast','lightning-threat-zones']),true); assert.equal(allowedVectorProducts(['arbitrary']),false);
const polygon=(x:number)=>({type:'Polygon' as const,coordinates:[[[x,0],[x+2,0],[x+2,2],[x,2],[x,0]]]});
const territories={type:'FeatureCollection' as const,features:[{type:'Feature' as const,geometry:polygon(0),properties:{id:'a',name:'Test territory'}},{type:'Feature' as const,geometry:polygon(10),properties:{id:'b',name:'Clear territory'}}]};
const props:StormFeatureProperties={id:'warning',kind:'alert',provider:'noaa',event:'Severe thunderstorm',severity:'severe',category:'thunderstorm',headline:'Warning'};
const risk={type:'FeatureCollection' as const,features:[{type:'Feature' as const,geometry:polygon(1),properties:props}]};
assert.deepEqual(stormTerritoryImpact(territories,risk).map(x=>x.id),['a']);
assert.deepEqual(stormTerritoryImpact(territories,{...risk,features:[{...risk.features[0],properties:{...props,kind:'report' as const}}]}),[]);
console.log('Strongest defaults, saved preferences, timeline bounds, proxy routes, and campaign risk intersections passed');

const historicalHail = hailViewSettings(STRONGEST_STORM_SETTINGS, 'history');
assert.equal(historicalHail.mode, 'history');
assert.equal(historicalHail.historyHours, 24);
assert.equal(historicalHail.shade, 'hail-size-max');
assert.equal(historicalHail.radar, false);
assert.equal(historicalHail.hail, true);
assert.equal(hailViewSettings(historicalHail, 'live').shade, 'none');
assert.equal(hailViewSettings(historicalHail, 'live').mode, 'live');
assert.equal(readStormGLSettings(historicalHail).shade, 'hail-size-max');
assert.equal(isHistoricalHailShade('hail-size'), true);
assert.equal(isHistoricalHailShade('temperatures'), false);

// A mode switch must detach old child animations before seeking beyond their old range.

const order: string[] = [];
let oldAnimation = true;
const timeline = { pause: () => order.push('pause'), clear: () => { oldAnimation = false; order.push('clear'); }, startDate: new Date(0), endDate: new Date(1), goToDate: (date: Date) => { assert.equal(oldAnimation, false); assert.ok(date >= timeline.startDate && date <= timeline.endDate); order.push('seek'); } };
const active = new Set(['hail-size-max', 'hail-threats-polygons']);
resetStormTimeline({ timeline, removeWeatherLayer: (id: string) => order.push(id) } as unknown as Parameters<typeof resetStormTimeline>[0], active, { start: new Date(10), end: new Date(20) }, new Date(15));
assert.deepEqual(order, ['pause', 'hail-size-max', 'hail-threats-polygons', 'clear', 'seek']);
assert.equal(active.size, 0);
