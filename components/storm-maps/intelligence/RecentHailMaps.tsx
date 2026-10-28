'use client';
import { useCallback, useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { AustralianWeatherView } from '@/lib/storm-maps/australia';
import { recentMapDates } from '@/lib/storm-maps/intelligence/storm-browser';
import { WIND_COUNTRIES, type WindCountry } from '@/lib/storm-maps/intelligence/wind-archive-format';
export function RecentHailMaps({map,country,onView,onTerritory}:{map:mapboxgl.Map;country:WindCountry;onView:(view:AustralianWeatherView)=>void;onTerritory:()=>void}){
  const [dates]=useState(()=>recentMapDates()),[selected,setSelected]=useState('');
  const choose=useCallback((date:string)=>{setSelected(date);const start=new Date(`${date}T00:00:00Z`);onView({view:'history',range:{start,end:new Date(Math.min(+start+86400000,Date.now()))}});},[onView]);
  useEffect(()=>{map.setProjection('mercator');const bounds=country==='NZ'?[166,-48,185,-33]:WIND_COUNTRIES[country].bounds[0];map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:35,duration:500});choose(dates[0]);},[map,country,choose,dates]);
  return <section aria-label="Recent hail maps" className="space-y-3"><p className="text-sm font-semibold">Recent hail maps · {WIND_COUNTRIES[country].name}</p><p className="text-xs text-muted-foreground">Recent hail reports aren’t connected for this country. Choose a daily map; coverage may be limited.</p>{dates.map(date=><button type="button" key={date} aria-pressed={selected===date} onClick={()=>choose(date)} className="block min-h-11 w-full rounded-lg border border-border px-3 py-3 text-left text-sm aria-pressed:bg-muted">{date} · Daily hail map</button>)}<button type="button" onClick={onTerritory} className="min-h-11 w-full rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground">Select hail area on map</button><p className="text-[11px] text-muted-foreground">These entries are daily maps, not confirmed storm detections. Missing shading does not confirm no hail.</p></section>;
}
