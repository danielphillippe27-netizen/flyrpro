'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getInitialReducedMotion } from '@/lib/demo/canvas/useReducedMotion';
import { getDemoMapStyle } from '@/lib/demo/mapbox/demoMapStyle';
import { getMapboxGl } from '@/lib/demo/mapbox/loadMapboxGl';
import type { BeatCopy } from '@/lib/demo/payload';
import { Beat4Canvas } from './Beat4Canvas';

type LngLat = [number, number];
type SessionStatKey =
  | 'doors'
  | 'conversations'
  | 'leads'
  | 'flyers'
  | 'activeSeconds'
  | 'conversationRate'
  | 'leadRate'
  | 'distance';

type SessionStat = {
  key: SessionStatKey;
  label: string;
  value: number;
  formatter: (value: number) => string;
  wide?: boolean;
};

type SessionModel = {
  coordinates: LngLat[];
  distanceMeters: number;
  stats: SessionStat[];
};

type GeoJSONSourceLike = {
  setData: (data: GeoJSON.FeatureCollection) => void;
};

type DemoMapLike = {
  addLayer: (layer: Record<string, unknown>) => void;
  addSource: (id: string, source: Record<string, unknown>) => void;
  fitBounds: (bounds: unknown, options: Record<string, unknown>) => void;
  getSource: (id: string) => GeoJSONSourceLike | undefined;
  once: (event: 'load' | 'error', callback: (event?: { error?: Error }) => void) => void;
  remove: () => void;
  resize: () => void;
};

const TARGET_ZOOM = 15.5;
const WALKING_METERS_PER_SECOND = 1.25;
const ROUTE_SOURCE_ID = 'demo-b4-session-route-source';
const ROUTE_LAYER_ID = 'demo-b4-session-route-line';
const POINT_SOURCE_ID = 'demo-b4-session-points-source';
const POINT_LAYER_ID = 'demo-b4-session-points';
const ROUTE_DRAW_DURATION_MS = 2600;
const SESSION_DOOR_COUNT = 32;
const SESSION_CONVERSATIONS = 7;
const SESSION_LEADS = 4;
const SESSION_FLYERS = 30;

const OSHAWA_SESSION_ROUTE: LngLat[] = [
  [-78.865524, 43.8970384],
  [-78.865524, 43.8973584],
  [-78.865144, 43.8973584],
  [-78.865144, 43.8976424],
  [-78.864684, 43.8976424],
  [-78.864684, 43.8979184],
  [-78.864164, 43.8979184],
  [-78.864164, 43.8976264],
  [-78.863704, 43.8976264],
  [-78.863704, 43.8979464],
  [-78.863164, 43.8979464],
  [-78.863164, 43.8976904],
  [-78.862644, 43.8976904],
  [-78.862644, 43.8973984],
  [-78.862164, 43.8973984],
  [-78.862164, 43.8971184],
  [-78.861744, 43.8971184],
];

function renderLines(value: string) {
  return value.split('\n').map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

function segmentMeters(a: LngLat, b: LngLat) {
  const lat = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const east = (b[0] - a[0]) * 111_320 * Math.cos(lat);
  const north = (b[1] - a[1]) * 110_540;
  return Math.hypot(east, north);
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}%`;
}

function formatDistance(value: number) {
  return `${Math.round(value).toLocaleString()} m`;
}

function numberFormatter(value: number) {
  return Math.round(value).toLocaleString();
}

function buildSessionModel(): SessionModel {
  const coordinates = OSHAWA_SESSION_ROUTE;
  const distanceMeters = coordinates.reduce((sum, point, index) => {
    if (index === 0) return sum;
    return sum + segmentMeters(coordinates[index - 1], point);
  }, 0);
  const doors = SESSION_DOOR_COUNT;
  const conversations = SESSION_CONVERSATIONS;
  const leads = SESSION_LEADS;
  const flyers = SESSION_FLYERS;

  const activeSeconds = distanceMeters / WALKING_METERS_PER_SECOND;
  const conversationRate = doors > 0 ? (conversations / doors) * 100 : 0;
  const leadRate = conversations > 0 ? (leads / conversations) * 100 : 0;

  return {
    coordinates,
    distanceMeters,
    stats: [
      { key: 'doors', label: 'Doors', value: doors, formatter: numberFormatter },
      { key: 'conversations', label: 'Conversations', value: conversations, formatter: numberFormatter },
      { key: 'leads', label: 'Leads', value: leads, formatter: numberFormatter },
      { key: 'flyers', label: 'Flyers Delivered', value: flyers, formatter: numberFormatter },
      { key: 'activeSeconds', label: 'Active Time', value: activeSeconds, formatter: formatDuration },
      { key: 'conversationRate', label: 'Conversation Rate', value: conversationRate, formatter: formatPercent },
      { key: 'leadRate', label: 'Lead Rate', value: leadRate, formatter: formatPercent },
      { key: 'distance', label: 'Distance (meters)', value: distanceMeters, formatter: formatDistance, wide: true },
    ],
  };
}

function routeFeature(coordinates: LngLat[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const lineCoordinates = coordinates.length === 1 ? [coordinates[0], coordinates[0]] : coordinates;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: lineCoordinates },
      },
    ],
  };
}

function pointFeatures(coordinates: LngLat[], showEnd: boolean): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return {
    type: 'FeatureCollection',
    features:
      first && last
        ? [
            { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: first } },
            ...(showEnd
              ? [{ type: 'Feature' as const, properties: { kind: 'end' }, geometry: { type: 'Point' as const, coordinates: last } }]
              : []),
          ]
        : [],
  };
}

function interpolateRoute(coordinates: LngLat[], progress: number) {
  if (progress >= 1) return coordinates;
  if (coordinates.length <= 1) return coordinates;

  const segments = coordinates.slice(0, -1).map((coord, index) => {
    const next = coordinates[index + 1];
    return {
      a: coord,
      b: next,
      length: Math.hypot(next[0] - coord[0], next[1] - coord[1]),
    };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = total * progress;
  const partial: LngLat[] = [coordinates[0]];

  for (const segment of segments) {
    if (remaining <= 0) break;
    const take = Math.min(segment.length, remaining);
    const ratio = segment.length === 0 ? 1 : take / segment.length;
    partial.push([
      segment.a[0] + (segment.b[0] - segment.a[0]) * ratio,
      segment.a[1] + (segment.b[1] - segment.a[1]) * ratio,
    ]);
    remaining -= segment.length;
  }

  return partial;
}

function mapSource(map: DemoMapLike, id: string) {
  return map.getSource(id);
}

function routeDiagonalSegmentCount(coordinates: LngLat[]) {
  return coordinates.reduce((count, coordinate, index) => {
    if (index === 0) return count;
    const previous = coordinates[index - 1];
    const changedLng = coordinate[0] !== previous[0];
    const changedLat = coordinate[1] !== previous[1];
    return count + (changedLng && changedLat ? 1 : 0);
  }, 0);
}

function useCountUp(visible: boolean, reduceMotion: boolean) {
  const [progress, setProgress] = useState(0);
  const animationRef = useRef<number | null>(null);
  const playedRef = useRef(false);

  useEffect(() => {
    if (!visible || playedRef.current) return;
    playedRef.current = true;

    if (reduceMotion) {
      setProgress(1);
      return;
    }

    const start = performance.now();
    const duration = 1200;

    function step(now: number) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setProgress(eased);
      if (p < 1) {
        animationRef.current = requestAnimationFrame(step);
      }
    }

    animationRef.current = requestAnimationFrame(step);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [reduceMotion, visible]);

  return progress;
}

function StaticRouteSvg({ model, progress }: { model: SessionModel; progress: number }) {
  const width = 1000;
  const height = 560;
  const minX = Math.min(...model.coordinates.map((point) => point[0]));
  const maxX = Math.max(...model.coordinates.map((point) => point[0]));
  const minY = Math.min(...model.coordinates.map((point) => point[1]));
  const maxY = Math.max(...model.coordinates.map((point) => point[1]));
  const scale = Math.min((width - 160) / Math.max(1, maxX - minX), (height - 140) / Math.max(1, maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const projected = model.coordinates.map((point) => [offsetX + (point[0] - minX) * scale, offsetY + (point[1] - minY) * scale]);
  const partial = interpolateCanvasPath(projected, progress);
  const points = partial.map((point) => point.join(',')).join(' ');
  const start = projected[0];
  const end = projected[projected.length - 1];

  return (
    <svg className="demo-session-fallback-map" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Session breadcrumb route">
      <rect width={width} height={height} fill="#0c0c0a" />
      <g opacity="0.18" stroke="#4c4c4c" strokeWidth="1">
        {Array.from({ length: 14 }).map((_, index) => (
          <line key={`v-${index}`} x1={80 + index * 66} y1="0" x2={80 + index * 66} y2={height} />
        ))}
        {Array.from({ length: 9 }).map((_, index) => (
          <line key={`h-${index}`} x1="0" y1={64 + index * 58} x2={width} y2={64 + index * 58} />
        ))}
      </g>
      <polyline points={points} fill="none" stroke="#2563EB" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.88" />
      {progress > 0 && start ? <circle cx={start[0]} cy={start[1]} r="7" fill="#22C55E" stroke="#FFFFFF" strokeWidth="2" /> : null}
      {progress >= 1 && end ? <circle cx={end[0]} cy={end[1]} r="7" fill="#EF4444" stroke="#FFFFFF" strokeWidth="2" /> : null}
    </svg>
  );
}

function interpolateCanvasPath(points: number[][], progress: number) {
  if (progress >= 1) return points;
  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    return { a: point, b: next, length: Math.hypot(next[0] - point[0], next[1] - point[1]) };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = total * progress;
  const partial = [points[0]];

  for (const segment of segments) {
    if (remaining <= 0) break;
    const take = Math.min(segment.length, remaining);
    const ratio = segment.length === 0 ? 1 : take / segment.length;
    partial.push([segment.a[0] + (segment.b[0] - segment.a[0]) * ratio, segment.a[1] + (segment.b[1] - segment.a[1]) * ratio]);
    remaining -= segment.length;
  }

  return partial;
}

function SessionMap({
  center,
  model,
  active,
  reducedMotion,
}: {
  center?: LngLat;
  model: SessionModel;
  active: boolean;
  reducedMotion: boolean;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<DemoMapLike | null>(null);
  const drawAnimationRef = useRef<number | null>(null);
  const drawStartedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [fallback, setFallback] = useState(!center);

  useEffect(() => {
    if (!center || !mapContainerRef.current || mapRef.current) return;
    let cancelled = false;

    async function initMap() {
      try {
        const [mapboxglModule, style] = await Promise.all([getMapboxGl(), getDemoMapStyle('dark')]);
        if (cancelled || !mapContainerRef.current) return;

        const mapboxgl = mapboxglModule.default ?? mapboxglModule;
        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          center,
          zoom: TARGET_ZOOM,
          pitch: 0,
          bearing: 0,
          interactive: false,
          attributionControl: false,
          style,
        }) as unknown as DemoMapLike;
        mapRef.current = map;

        await new Promise<void>((resolve, reject) => {
          map.once('load', () => resolve());
          map.once('error', (event) => reject(event?.error ?? new Error('Beat 4 map failed to load.')));
        });

        if (cancelled) return;

        map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: routeFeature([model.coordinates[0]]) });
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#2563EB',
            'line-width': 5,
            'line-opacity': 0.88,
          },
        });
        map.addSource(POINT_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: POINT_LAYER_ID,
          type: 'circle',
          source: POINT_SOURCE_ID,
          paint: {
            'circle-radius': 6,
            'circle-color': ['match', ['get', 'kind'], 'start', '#22C55E', 'end', '#EF4444', '#2563EB'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          },
        });

        const bounds = new mapboxgl.LngLatBounds();
        model.coordinates.forEach((coordinate) => bounds.extend(coordinate));
        map.fitBounds(bounds, { padding: 44, maxZoom: 17, duration: 0 });
        map.resize();
        setMapReady(true);
      } catch (error) {
        console.error('[Beat4] Falling back to static breadcrumb after Mapbox load failed:', error);
        setFallback(true);
      }
    }

    void initMap();

    return () => {
      cancelled = true;
      if (drawAnimationRef.current !== null) {
        cancelAnimationFrame(drawAnimationRef.current);
        drawAnimationRef.current = null;
      }
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [center, model]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !active || drawStartedRef.current) return;
    drawStartedRef.current = true;
    mapSource(map, ROUTE_SOURCE_ID)?.setData(routeFeature([model.coordinates[0]]));
    mapSource(map, POINT_SOURCE_ID)?.setData(pointFeatures(model.coordinates, false));

    if (reducedMotion) {
      mapSource(map, ROUTE_SOURCE_ID)?.setData(routeFeature(model.coordinates));
      mapSource(map, POINT_SOURCE_ID)?.setData(pointFeatures(model.coordinates, true));
      return;
    }

    const start = performance.now();

    function step(now: number) {
      const map = mapRef.current;
      if (!map) return;
      const p = Math.min(1, (now - start) / ROUTE_DRAW_DURATION_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      mapSource(map, ROUTE_SOURCE_ID)?.setData(routeFeature(interpolateRoute(model.coordinates, eased)));
      mapSource(map, POINT_SOURCE_ID)?.setData(pointFeatures(model.coordinates, p >= 1));

      if (p < 1) {
        drawAnimationRef.current = requestAnimationFrame(step);
      }
    }

    drawAnimationRef.current = requestAnimationFrame(step);
  }, [active, mapReady, model, reducedMotion]);

  if (fallback) {
    return <StaticRouteSvg model={model} progress={active ? 1 : 0} />;
  }

  return <div ref={mapContainerRef} className="demo-session-mapbox" />;
}

function Beat4Session({ copy, center }: { copy: BeatCopy; center?: LngLat }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const model = useMemo(() => buildSessionModel(), []);
  const progress = useCountUp(visible, reducedMotion);
  const diagonalCount = useMemo(() => routeDiagonalSegmentCount(model.coordinates), [model]);

  useEffect(() => {
    setReducedMotion(getInitialReducedMotion());
    const card = cardRef.current;
    if (!card) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setVisible(true);
      },
      { threshold: 0.35 }
    );
    observer.observe(card);

    return () => observer.disconnect();
  }, []);

  return (
    <section id="b4">
      <div className="rv eyebrow">Beat 04 · Ground truth</div>
      <h2 className="h-big rv d1">{renderLines(copy.b4Headline)}</h2>
      <p className="sub rv d2">{copy.b4Sub}</p>
      <div className="demo-session-card rv d3" ref={cardRef} data-diagonal-segments={diagonalCount}>
        <div className="demo-session-header">
          <div>
            <h3>Sessions details</h3>
            <p>The U · Daniel Phillippe at 7:39 PM</p>
          </div>
          <span>Completed session</span>
        </div>
        <SessionMap center={center} model={model} active={visible} reducedMotion={reducedMotion} />
        <div className="demo-session-stats">
          {model.stats.map((stat) => (
            <div className={stat.wide ? 'wide' : undefined} key={stat.key}>
              <small>{stat.label}</small>
              <b>{stat.formatter(stat.value * progress)}</b>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Beat4({ copy, center }: { copy: BeatCopy; center?: LngLat }) {
  if (!center) {
    return <Beat4Canvas copy={copy} />;
  }

  return <Beat4Session copy={copy} center={center} />;
}
