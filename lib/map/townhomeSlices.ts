import { feature, featureCollection, intersect, pointOnFeature } from '@turf/turf';
import { compareAddressesForDisplay, resolveHouseNumberLabel } from './addressPresentation';
import type { CampaignAddress } from '@/types/database';
import type { CanonicalClientTileBundle } from './canonicalTileBundle';

export type TownhomeFootprint = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
export type TownhomeSlice = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, {
  building_id: string; address_id: string; house_number: string; unit_index: number;
  slice_index: number; unit_count: number; overlay_height: number; overlay_base: number;
}>;
const key = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export function buildingIdentity(building: GeoJSON.Feature): string {
  const p = building.properties ?? {};
  return key(p.canonical_building_id ?? p.building_id ?? p.gers_id ?? building.id ?? p.id);
}
export function addressCoordinate(address: CampaignAddress): number[] | null {
  if (address.coordinate && Number.isFinite(address.coordinate.lon) && Number.isFinite(address.coordinate.lat)) {
    return [address.coordinate.lon, address.coordinate.lat];
  }
  const p = address as unknown as Record<string, unknown>;
  const geom = (p.geom_json ?? p.geom ?? p.geometry) as GeoJSON.Point | undefined;
  return geom?.type === 'Point' && geom.coordinates.slice(0, 2).every(Number.isFinite) ? geom.coordinates : null;
}

/** Only explicit joins participate. Never assign a nearby home to a shared footprint. */
export function townhomeAddressGroups(buildings: Array<{ id: string; properties: Record<string, unknown> }>, addresses: CampaignAddress[], links: CanonicalClientTileBundle['links'] = []) {
  const aliases = new Map<string, string | null>();
  const groups = new Map<string, CampaignAddress[]>();
  const byAddress = new Map(addresses.map(a => [key(a.id), a]));
  for (const b of buildings) for (const value of [b.id, b.properties.row_id, b.properties.gers_id, b.properties.building_id, b.properties.canonical_building_id]) {
    const alias = key(value); if (!alias) continue;
    aliases.set(alias, aliases.has(alias) && aliases.get(alias) !== key(b.id) ? null : key(b.id));
  }
  const live = new Map<string, string | null>();
  for (const a of addresses) {
    const id = key(a.building_id ?? a.building_gers_id);
    if (id) live.set(key(a.id), aliases.get(id) ?? null);
  }
  const add = (building: string, addressId: unknown) => {
    const a = byAddress.get(key(addressId)); if (!a) return;
    if (live.has(key(a.id)) && live.get(key(a.id)) !== building) return;
    const group = groups.get(building) ?? [];
    if (!group.some(existing => key(existing.id) === key(a.id))) group.push(a);
    groups.set(building, group);
  };
  for (const raw of links) {
    const link = raw as Record<string, unknown>;
    const building = aliases.get(key(link.building_id)); if (building) add(building, link.address_id);
  }
  for (const b of buildings) {
    for (const value of [b.properties.address_ids, b.properties.linked_address_ids]) {
      if (Array.isArray(value)) for (const id of value) add(key(b.id), id);
    }
    add(key(b.id), b.properties.address_id ?? b.properties.primary_address_id);
  }
  for (const a of addresses) { const building = live.get(key(a.id)); if (building) add(building, a.id); }
  // Historical conflicting links stay unresolved; do not paint the same address on two rows.
  const owners=new Map<string,Set<string>>();
  for(const [id,group] of groups)for(const address of group){
    const set=owners.get(key(address.id))??new Set<string>();set.add(id);owners.set(key(address.id),set);
  }
  for(const [id,group] of groups)groups.set(id,group.filter(a=>owners.get(key(a.id))?.size===1));
  for (const [id, group] of groups) {
    if (group.length < 2) groups.delete(id);
    else group.sort((a,b) => compareAddressesForDisplay(a,b) || a.id.localeCompare(b.id));
  }
  return groups;
}

/** iOS principal-axis slicing, using metric coordinates and exact footprint clipping.
 * Preserve holes/disconnected parts; label and hit identity share the same slice index.
 */
export function splitTownhome(building: TownhomeFootprint, addresses: CampaignAddress[]): TownhomeSlice[] {
  const ordered = [...new Map(addresses.map(a => [key(a.id), a])).values()]
    .sort((a,b) => compareAddressesForDisplay(a,b) || a.id.localeCompare(b.id));
  if (ordered.length < 2) return [];
  const polygons = building.geometry.type === 'Polygon' ? [building.geometry.coordinates] : building.geometry.coordinates;
  const vertices = polygons.flatMap(p => p[0].slice(0,-1));
  if (vertices.length < 3 || vertices.some(p => !p.slice(0,2).every(Number.isFinite))) return [];
  const center = [0,1].map(d => vertices.reduce((sum,p) => sum+p[d],0)/vertices.length);
  const lonScale = Math.max(Math.cos(center[1]*Math.PI/180)*111320, .0001);
  const metric = (p: number[]) => [(p[0]-center[0])*lonScale, (p[1]-center[1])*111320];
  const xy = vertices.map(metric);
  const xx = xy.reduce((sum,p)=>sum+p[0]*p[0],0), yy = xy.reduce((sum,p)=>sum+p[1]*p[1],0), xySum = xy.reduce((sum,p)=>sum+p[0]*p[1],0);
  const angle = .5*Math.atan2(2*xySum,xx-yy), c=Math.cos(angle), s=Math.sin(angle);
  const project = (p:number[]) => { const [x,y]=metric(p);return [x*c+y*s,-x*s+y*c]; };
  const restore = (u:number,v:number) => [center[0]+(u*c-v*s)/lonScale,center[1]+(u*s+v*c)/111320];
  const uv=vertices.map(project), min=Math.min(...uv.map(p=>p[0])), max=Math.max(...uv.map(p=>p[0]));
  if (max-min < .01) return [];
  const vmin=Math.min(...uv.map(p=>p[1]))-1, vmax=Math.max(...uv.map(p=>p[1]))+1;
  const projections = ordered.map((a,index)=>({index,u:addressCoordinate(a) ? project(addressCoordinate(a)!)[0] : null}));
  const usable=projections.filter((p):p is {index:number;u:number} => p.u !== null);
  const distinct = usable.length === ordered.length && Math.max(...usable.map(p=>p.u))-Math.min(...usable.map(p=>p.u)) > .05;
  const spatial = distinct ? [...usable].sort((a,b)=>a.u-b.u || a.index-b.index).map(p=>p.index) : ordered.map((_,i)=>i);
  // Missing coordinates retain natural order, reversed only with measurable directional evidence.
  if (!distinct && usable.length > 1) {
    const meanI=usable.reduce((sum,p)=>sum+p.index,0)/usable.length, meanU=usable.reduce((sum,p)=>sum+p.u,0)/usable.length;
    if (usable.reduce((sum,p)=>sum+(p.index-meanI)*(p.u-meanU),0) < -.000001) spatial.reverse();
  }
  const props=building.properties ?? {};
  const raw=Number(props.render_height ?? props.height_m ?? props.height ?? 5.2);
  const height=Math.min(Math.max(Number.isFinite(raw) ? raw : 5.2,5.2),14)*.5;
  const rawBase=Math.max(Number(props.min_height ?? 0)*.5,0), base=rawBase < height ? rawBase : 0;
  const slices:TownhomeSlice[]=[];
  try {
    for (let i=0;i<ordered.length;i++) {
      const start=min+(max-min)*i/ordered.length, end=min+(max-min)*(i+1)/ordered.length;
      const box=feature({type:'Polygon',coordinates:[[restore(start,vmin),restore(end,vmin),restore(end,vmax),restore(start,vmax),restore(start,vmin)]]} as GeoJSON.Polygon);
      const clipped=intersect(featureCollection([building,box]));
      if (!clipped) return []; // Never publish a partial row with misnumbered units.
      const index=spatial[i], address=ordered[index];
      slices.push({...clipped,id:`townhome:${buildingIdentity(building)}:${address.id}`,properties:{building_id:buildingIdentity(building),address_id:address.id,
        house_number:resolveHouseNumberLabel(address) ?? '',unit_index:index,slice_index:i,unit_count:ordered.length,overlay_height:height+.125,overlay_base:base}});
    }
  } catch { return []; }
  return slices;
}
export function townhomeLabels(slices:TownhomeSlice[]):GeoJSON.FeatureCollection<GeoJSON.Point> {
  return featureCollection(slices.map(slice=>({...pointOnFeature(slice),id:slice.id,properties:slice.properties})));
}
