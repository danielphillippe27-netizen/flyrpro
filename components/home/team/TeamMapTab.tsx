'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from '@/lib/theme-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getMapboxToken } from '@/lib/mapbox';
import { Card, CardContent } from '@/components/ui/card';

const MAP_STYLES = {
  light: 'mapbox://styles/fliper27/cml6z0dhg002301qo9xxc08k4',
  dark: 'mapbox://styles/fliper27/cml6zc5pq002801qo4lh13o19',
} as const;

const ROUTES_SOURCE_ID = 'team-routes';
const ROUTES_LAYER_ID = 'team-routes-layer';
const KNOCKS_SOURCE_ID = 'team-knocks';
const KNOCKS_LAYER_ID = 'team-knocks-layer';

type MapMember = { user_id: string; display_name: string; color: string };
type MapSession = {
  session_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  distance_meters?: number;
  doors_hit?: number;
  conversations?: number;
  flyers_delivered?: number;
  path_geojson?: string | null;
};

type TeamMapTabProps = {
  range: { start: string; end: string };
  memberIds: string[];
  mapMode: 'routes' | 'knocked_homes';
};

function buildRoutesGeoJSON(
  sessions: MapSession[],
  members: MapMember[]
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const memberMap = new Map(members.map((m) => [m.user_id, m]));
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const s of sessions) {
    const route = parseLineString(s.path_geojson);
    if (!route || !route.coordinates?.length) continue;
    const m = memberMap.get(s.user_id);
    const color = m?.color ?? '#3B82F6';
    features.push({
      type: 'Feature',
      properties: {
        session_id: s.session_id,
        user_id: s.user_id,
        display_name: m?.display_name ?? 'Member',
        color,
        duration_seconds: s.duration_seconds,
        doors_hit: s.doors_hit ?? 0,
        conversations: s.conversations ?? 0,
        flyers_delivered: s.flyers_delivered ?? 0,
        distance_meters: s.distance_meters ?? 0,
        started_at: s.started_at,
        ended_at: s.ended_at,
      },
      geometry: route,
    });
  }
  return { type: 'FeatureCollection', features };
}

export function TeamMapTab({ range, memberIds, mapMode }: TeamMapTabProps) {
  const { theme } = useTheme();
  const { currentWorkspaceId } = useWorkspace();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const [members, setMembers] = useState<MapMember[]>([]);
  const [sessions, setSessions] = useState<MapSession[]>([]);
  const [knockEvents, setKnockEvents] = useState<Array<{ payload?: { lat?: number; lng?: number; [k: string]: unknown }; display_name?: string; user_id?: string }>>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMapData = useCallback(async () => {
    if (!currentWorkspaceId) {
      setMembers([]);
      setSessions([]);
      setKnockEvents([]);
      setError('No workspace selected');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/team/map?workspaceId=${encodeURIComponent(currentWorkspaceId)}&start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}&mode=${encodeURIComponent(mapMode)}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMembers(data.members ?? []);
      setSessions(data.sessions ?? []);
      const points = (data.knockPoints ?? []) as Array<{ payload?: { lat?: number; lng?: number }; user_id?: string }>;
      setKnockEvents(
        points.filter((event) => {
          if (!event.payload || typeof event.payload.lat !== 'number' || typeof event.payload.lng !== 'number') return false;
          if (memberIds.length === 0) return true;
          return memberIds.includes(event.user_id ?? '');
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load map data');
      setMembers([]);
      setSessions([]);
      setKnockEvents([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, range.start, range.end, mapMode, memberIds]);

  useEffect(() => {
    fetchMapData();
  }, [fetchMapData]);

  // Map init
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const token = getMapboxToken();
    if (!token) {
      setError('Mapbox token not configured');
      return;
    }
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLES.light,
      center: [-79.3832, 43.6532],
      zoom: 11,
    });
    map.on('load', () => setMapLoaded(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const style = MAP_STYLES[theme === 'dark' ? 'dark' : 'light'] ?? MAP_STYLES.light;
    mapRef.current.setStyle(style);
  }, [theme, mapLoaded]);

  // Routes layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const filteredSessions = memberIds.length === 0 ? sessions : sessions.filter((s) => memberIds.includes(s.user_id));
    const geo = buildRoutesGeoJSON(filteredSessions, members);
    const ensureRoutesLayer = () => {
      if (!map.isStyleLoaded()) return;
      try {
        const existing = map.getSource(ROUTES_SOURCE_ID);
        if (existing && 'setData' in existing) {
          (existing as mapboxgl.GeoJSONSource).setData(geo);
        } else if (!existing) {
          map.addSource(ROUTES_SOURCE_ID, { type: 'geojson', data: geo });
        }
        if (!map.getLayer(ROUTES_LAYER_ID)) {
          map.addLayer({
            id: ROUTES_LAYER_ID,
            type: 'line',
            source: ROUTES_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 5,
              'line-opacity': 0.85,
            },
          });
        }
      } catch (e) {
        console.error('TeamMapTab routes layer:', e);
      }
    };
    if (map.isStyleLoaded()) {
      ensureRoutesLayer();
      const layer = map.getLayer(ROUTES_LAYER_ID);
      if (layer) map.setLayoutProperty(ROUTES_LAYER_ID, 'visibility', mapMode === 'routes' ? 'visible' : 'none');
    } else map.once('style.load', () => { ensureRoutesLayer(); const l = map.getLayer(ROUTES_LAYER_ID); if (l) map.setLayoutProperty(ROUTES_LAYER_ID, 'visibility', mapMode === 'routes' ? 'visible' : 'none'); });
  }, [mapLoaded, sessions, members, mapMode, memberIds]);

  // Knocked homes layer (points from activity payload)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mapMode !== 'knocked_homes') return;

    const memberMap = new Map(members.map((m) => [m.user_id, m]));
    const features: GeoJSON.Feature<GeoJSON.Point>[] = knockEvents.map((e, i) => ({
      type: 'Feature',
      id: i,
      properties: {
        color: memberMap.get(e.user_id ?? '')?.color ?? '#3B82F6',
        display_name: e.display_name ?? 'Member',
      },
      geometry: {
        type: 'Point',
        coordinates: [e.payload!.lng!, e.payload!.lat!],
      },
    }));

    const geo: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: 'FeatureCollection', features };

    const ensureKnocksLayer = () => {
      if (!map.isStyleLoaded()) return;
      try {
        const existing = map.getSource(KNOCKS_SOURCE_ID);
        if (existing && 'setData' in existing) {
          (existing as mapboxgl.GeoJSONSource).setData(geo);
        } else if (!existing) {
          map.addSource(KNOCKS_SOURCE_ID, { type: 'geojson', data: geo });
        }
        if (!map.getLayer(KNOCKS_LAYER_ID)) {
          map.addLayer({
            id: KNOCKS_LAYER_ID,
            type: 'circle',
            source: KNOCKS_SOURCE_ID,
            paint: {
              'circle-radius': 6,
              'circle-color': ['get', 'color'],
              'circle-opacity': 0.9,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#fff',
            },
          });
        }
        const layer = map.getLayer(KNOCKS_LAYER_ID);
        if (layer) map.setLayoutProperty(KNOCKS_LAYER_ID, 'visibility', mapMode === 'knocked_homes' ? 'visible' : 'none');
      } catch (e) {
        console.error('TeamMapTab knocks layer:', e);
      }
    };

    if (map.isStyleLoaded()) ensureKnocksLayer();
    else map.once('style.load', ensureKnocksLayer);
  }, [mapLoaded, mapMode, knockEvents, members]);

  // Route click popup
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mapMode !== 'routes') return;

    const onRouteClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f?.properties) return;
      popupRef.current?.remove();
      const props = f.properties as Record<string, unknown>;
      const doors = props.doors_hit ?? '—';
      const convos = props.conversations ?? '—';
      const flyers = props.flyers_delivered ?? '—';
      const duration = typeof props.duration_seconds === 'number' ? `${Math.round(props.duration_seconds / 60)} min` : '—';

      popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="p-2 min-w-[160px]">
            <p class="font-semibold text-sm">${escapeHtml(String(props.display_name ?? 'Member'))}</p>
            <p class="text-xs text-gray-500 mt-1">Duration: ${escapeHtml(String(duration))}</p>
            <p class="text-xs">Doors: ${escapeHtml(String(doors))} · Convos: ${escapeHtml(String(convos))} · Flyers: ${escapeHtml(String(flyers))}</p>
          </div>`
        )
        .addTo(map);
    };

    map.on('click', ROUTES_LAYER_ID, onRouteClick);
    return () => {
      map.off('click', ROUTES_LAYER_ID, onRouteClick);
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, [mapLoaded, mapMode]);

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="relative rounded-xl border border-border overflow-hidden bg-card" style={{ minHeight: 400 }}>
        <div ref={mapContainerRef} className="w-full h-[420px]" />
        {loading && (
          <div className="absolute top-4 left-4 z-10 bg-background/80 px-3 py-1.5 rounded text-sm shadow">
            Loading…
          </div>
        )}
      </div>

      {mapMode === 'knocked_homes' && knockEvents.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No knock locations with coordinates in this period.</p>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function parseLineString(raw: string | null | undefined): GeoJSON.LineString | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as GeoJSON.Geometry;
    if (parsed?.type === 'LineString' && Array.isArray(parsed.coordinates)) {
      return parsed as GeoJSON.LineString;
    }
    return null;
  } catch {
    return null;
  }
}
