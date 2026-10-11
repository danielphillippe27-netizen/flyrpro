'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import { useWorkspace } from '@/lib/workspace-context';
import { StormMapsControl } from '@/components/storm-maps/StormMapsControl';

export default function StormsPage() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { currentWorkspaceId } = useWorkspace();
  const router = useRouter();
  useEffect(() => {
    if (!container.current) return;
    mapboxgl.accessToken = getMapboxToken();
    const instance = new mapboxgl.Map({ container: container.current, style: 'mapbox://styles/mapbox/dark-v11', center: [-85, 39], zoom: 4, projection: 'mercator' });
    instance.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    instance.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
    setMap(instance);
    const ready = () => setLoaded(true);
    instance.on('load', ready);
    return () => { instance.off('load', ready); removeMapboxMapWhenSafe(instance); };
  }, []);
  return <div className="relative min-h-0 flex-1 overflow-hidden" aria-label="Storm Maps workspace">
    <div ref={container} className="absolute inset-0" />
    <StormMapsControl standalone map={map} mapLoaded={loaded} workspaceId={currentWorkspaceId} onStormCampaign={context => { if (context.territoryId) router.push(`/campaigns/create?stormTerritory=${encodeURIComponent(context.territoryId)}`); }} />
    {!loaded && <p role="status" className="absolute left-5 top-5 rounded-xl bg-slate-950 p-4 text-white">Loading storm map…</p>}
  </div>;
}
