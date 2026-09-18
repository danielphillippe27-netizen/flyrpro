'use client';
import { useEffect } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { createClient } from '@/lib/supabase/client';
/** Replays independent card state when sources/styles reload; never writes status or scan counters. */
export function useCardEngagement(map:MapboxMap|null|undefined,campaignId:string|null|undefined,source:string,kind:'building'|'address',sourceLayer?:string) {
 useEffect(()=>{
  if(!map||!campaignId)return;
  const client=createClient();let stopped=false;let ids=new Set<string>();let applied=new Set<string>();
  const apply=()=>{if(stopped||!map.getSource(source))return;for(const id of new Set([...ids,...applied])){try{map.setFeatureState({source,...(sourceLayer?{sourceLayer}:{}),id},{card_engaged:ids.has(id)});}catch{}}applied=new Set(ids);};
  const refresh=async()=>{const {data,error}=await client.from('card_property_engagement').select('address_id,building_id').eq('campaign_id',campaignId);if(stopped||error)return;ids=new Set((data??[]).map(r=>kind==='building'?r.building_id:r.address_id).filter((id):id is string=>!!id).map(id=>id.toLowerCase()));apply();};
  void refresh();const channel=client.channel(`cards-map-${campaignId}-${source}`).on('postgres_changes',{event:'*',schema:'public',table:'card_property_engagement',filter:`campaign_id=eq.${campaignId}`},()=>{void refresh();}).subscribe();
  const interval=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},15000);
  const focus=()=>{if(document.visibilityState==='visible')void refresh();};
  const sourceReady=(event: {sourceId?:string;sourceDataType?:string})=>{if(event.sourceId===source&&event.sourceDataType==='metadata')apply();};
  map.on('style.load',apply);map.on('sourcedata',sourceReady);document.addEventListener('visibilitychange',focus);
  return()=>{stopped=true;clearInterval(interval);map.off('style.load',apply);map.off('sourcedata',sourceReady);document.removeEventListener('visibilitychange',focus);void client.removeChannel(channel);};
 },[map,campaignId,source,kind,sourceLayer]);
}
