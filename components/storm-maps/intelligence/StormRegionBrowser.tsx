'use client';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { AustralianWeatherView } from '@/lib/storm-maps/australia';
import { stormBrowserDefaults } from '@/lib/storm-maps/intelligence/storm-browser';
import { StormCountryContext } from '@/lib/storm-maps/storm-country-context';
import { type WindCountry } from '@/lib/storm-maps/intelligence/wind-archive-format';
import { AustralianStormPanel } from './AustralianStormPanel';
import { RecentWindStorms } from './RecentWindStorms';
import { WindStormArchive } from './WindStormArchive';
import { RecentHailMaps } from './RecentHailMaps';
import type { StormWindActions } from '../StormWorkbenchView';
import type { SaveWindTerritory } from './WindZoneSelector';
import type { StormEvent } from '@/lib/storm-maps/intelligence/model';
const field='min-h-11 w-full rounded-lg border border-border bg-background p-2 text-base text-foreground md:text-xs';
export function StormRegionBrowser({map,workspaceId,onAustralianView,onReports,onWindView,windActive,onSaveWind,windActions,onEvent,onTerritory,renderReports,renderHistory}:{
  map:mapboxgl.Map;workspaceId:string;onAustralianView:(value:AustralianWeatherView)=>void;onReports:()=>void;onWindView:()=>void;windActive:boolean;onSaveWind:SaveWindTerritory;windActions?:StormWindActions;onEvent:(event:StormEvent|null)=>void;onTerritory:()=>void;renderReports:()=>ReactNode;renderHistory?:(country:WindCountry)=>ReactNode;
}){
  const [historic,setHistoric]=useState(false);
  const [filters,setFilters]=useState<{country:WindCountry;type:'hail'|'wind'}|null>(null);
  useEffect(()=>{setFilters(stormBrowserDefaults(new URLSearchParams(window.location.search)));},[]);
  const countrySettings=useContext(StormCountryContext);
  const country=countrySettings?.country??filters?.country,type=filters?.type;
  const selectedCountry=country??'CA';
  useEffect(()=>{setHistoric(false);},[country,type]);
  useEffect(()=>{
    if(!country||!type)return;
    if(type==='wind')onWindView();else if(country==='US')onReports();
    const query=new URLSearchParams(window.location.search);const previousCountry=stormBrowserDefaults(query).country;if(previousCountry!==country||type!=='wind'){query.delete('windTime');query.delete('minimum');}query.set('country',country);query.set('type',type);query.delete('region');
    window.history.replaceState(window.history.state,'',`${window.location.pathname}?${query}`);
  },[country,type,onReports,onWindView]);
  if(!filters)return <p role="status" className="text-xs">Loading storm filters…</p>;
  return <div className="space-y-3">
    <div aria-label="Storm filters" className="space-y-2">
      <label className="block text-xs">Type<select aria-label="Storm type" className={field} value={filters.type} onChange={event=>setFilters({...filters,type:event.target.value as 'hail'|'wind'})}><option value="hail">Hail</option><option value="wind">Wind</option></select></label>
    </div>
    <button type="button" aria-expanded={historic} onClick={()=>{onEvent(null);setHistoric(value=>!value);}} className="min-h-11 w-full rounded-lg border border-border px-3 py-2 text-left text-sm font-semibold">{historic?'← Back to recent storms':'+ Historic storm'}</button>
    {historic?(filters.type==='wind'?<WindStormArchive key={`history-wind:${selectedCountry}`} selectedCountry={selectedCountry} map={map} workspaceId={workspaceId} onView={onWindView} active={windActive} onSave={onSaveWind} windActions={windActions}/>:renderHistory?.(selectedCountry)) : filters.type==='wind'?<RecentWindStorms key={`wind:${selectedCountry}`} map={map} workspaceId={workspaceId} country={selectedCountry} onView={onWindView} active={windActive} onSave={onSaveWind} windActions={windActions}/>:selectedCountry==='AU'?<AustralianStormPanel simple map={map} workspaceId={workspaceId} onView={onAustralianView} onEvent={onEvent}/>:selectedCountry==='US'?renderReports():<RecentHailMaps key={`hail:${selectedCountry}`} map={map} country={selectedCountry} onView={onAustralianView} onTerritory={onTerritory}/>}
  </div>;
}
