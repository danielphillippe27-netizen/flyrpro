import type mapboxgl from 'mapbox-gl';
export const TOWNHOME_LAYERS = ['townhome-live-fill', 'townhome-live-selection', 'townhome-live-labels'];
/** A unit or its label wins over the whole building and parcel underneath it. */
export function hasTownhomeHit(map: mapboxgl.Map, point: mapboxgl.Point): boolean {
  const layers=TOWNHOME_LAYERS.filter(id=>map.getLayer(id));
  return layers.length>0 && map.queryRenderedFeatures(point,{layers}).length>0;
}

const ordering = new WeakSet<mapboxgl.Map>();
export function keepParcelsBelowHomes(map:mapboxgl.Map,parcelIds:string[]):void {
  if(ordering.has(map))return;
  ordering.add(map);
  try {
    const layers=map.getStyle()?.layers ?? [];
    const firstHome=layers.find(layer=>layer.type==='fill-extrusion'||TOWNHOME_LAYERS.includes(layer.id));
    if(!firstHome)return;
    const ids=layers.map(layer=>layer.id);
    const existing=parcelIds.filter(id=>ids.includes(id));
    const homeIndex=ids.indexOf(firstHome.id);
    const correctlyOrdered=existing.every((id,i)=>ids.indexOf(id)<homeIndex&&(i===0||ids.indexOf(existing[i-1])<ids.indexOf(id)));
    if(correctlyOrdered)return;
    for(const id of existing)map.moveLayer(id,firstHome.id);
  } finally {ordering.delete(map);}
}
