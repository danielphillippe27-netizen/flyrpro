'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GeoJSONSource,
  LngLatLike,
  Map as MapboxMap,
  MapboxGeoJSONFeature,
  PointLike,
} from 'mapbox-gl';
import { mulberry } from '@/lib/demo/canvas/cityModel';
import { getInitialReducedMotion } from '@/lib/demo/canvas/useReducedMotion';
import { track } from '@/lib/demo/analytics/track';
import { findDemoBuildingLayerId, getDemoStandardLightMapStyle } from '@/lib/demo/mapbox/demoMapStyle';
import { getMapboxGl } from '@/lib/demo/mapbox/loadMapboxGl';
import type { BeatCopy } from '@/lib/demo/payload';
import { Beat3Canvas } from './Beat3Canvas';

type LngLat = [number, number];

const POLYGON_SOURCE_ID = 'demo-b3-polygon-source';
const POLYGON_FILL_LAYER_ID = 'demo-b3-polygon-fill';
const POLYGON_LINE_LAYER_ID = 'demo-b3-polygon-line';
const POINTS_SOURCE_ID = 'demo-b3-points-source';
const POINTS_LAYER_ID = 'demo-b3-points';
const FRESH_POINTS_LAYER_ID = 'demo-b3-points-fresh';
const TARGET_ZOOM = 15.5;
const TERRITORY_RADIUS_RATIO = 0.2;
const ADDRESS_HIGHLIGHT_COLOR = '#6b7280';

function renderLines(value: string) {
  return value.split('\n').map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function polygonFeature(ring: LngLat[]): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[...ring, ring[0]]],
    },
  };
}

function lineFeature(coords: LngLat[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
  };
}

function pointFeature(coord: LngLat, index: number, fresh: boolean): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: { index, fresh },
    geometry: {
      type: 'Point',
      coordinates: coord,
    },
  };
}

function offsetMeters(center: LngLat, eastMeters: number, northMeters: number): LngLat {
  const latRad = (center[1] * Math.PI) / 180;
  const lngDelta = eastMeters / (111_320 * Math.max(Math.cos(latRad), 0.01));
  const latDelta = northMeters / 110_540;
  return [center[0] + lngDelta, center[1] + latDelta];
}

function metersPerPixelAtZoom(lat: number, zoom: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

function territoryRadiusMeters(center: LngLat, stageEl: HTMLElement) {
  const rect = stageEl.getBoundingClientRect();
  const smallerStageDimension = Math.min(rect.width, rect.height);
  return smallerStageDimension * TERRITORY_RADIUS_RATIO * metersPerPixelAtZoom(center[1], TARGET_ZOOM);
}

function buildTerritoryRing(center: LngLat, radiusMeters: number): LngLat[] {
  const bearings = [-118, -56, -6, 48, 111, 169, -164];
  const radiusMultipliers = [0.86, 1.12, 1.02, 0.91, 1.18, 0.96, 1.08];
  return bearings.map((bearing, index) => {
    const radians = (bearing * Math.PI) / 180;
    const radius = radiusMeters * radiusMultipliers[index];
    return offsetMeters(center, Math.cos(radians) * radius, Math.sin(radians) * radius);
  });
}

function mapPersonalizationLabel(company?: string, city?: string) {
  const companyText = company?.trim();
  const cityText = city?.trim();

  if (companyText && cityText) {
    return `${companyText} · ${cityText}`.toUpperCase();
  }

  return (cityText ?? '').toUpperCase();
}

function interpolateRing(ring: LngLat[], progress: number): LngLat[] {
  if (progress >= 1) {
    return [...ring, ring[0]];
  }

  const closed = [...ring, ring[0]];
  const segments = closed.slice(0, -1).map((point, index) => {
    const next = closed[index + 1];
    return {
      a: point,
      b: next,
      length: Math.hypot(next[0] - point[0], next[1] - point[1]),
    };
  });
  const perimeter = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = perimeter * progress;
  const coords: LngLat[] = [closed[0]];

  for (const segment of segments) {
    if (remaining <= 0) break;
    const take = Math.min(segment.length, remaining);
    const ratio = segment.length === 0 ? 1 : take / segment.length;
    coords.push([
      segment.a[0] + (segment.b[0] - segment.a[0]) * ratio,
      segment.a[1] + (segment.b[1] - segment.a[1]) * ratio,
    ]);
    remaining -= segment.length;
  }

  return coords;
}

function featureCentroid(feature: MapboxGeoJSONFeature): LngLat | null {
  const geometry = feature.geometry;
  if (!geometry) return null;

  let coords: number[][] = [];

  if (geometry.type === 'Polygon') {
    coords = geometry.coordinates[0] ?? [];
  } else if (geometry.type === 'MultiPolygon') {
    coords = geometry.coordinates[0]?.[0] ?? [];
  } else {
    return null;
  }

  const usable = coords.filter((coord) => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
  if (usable.length === 0) return null;

  const totals = usable.reduce(
    (acc, coord) => {
      acc.lng += coord[0];
      acc.lat += coord[1];
      return acc;
    },
    { lng: 0, lat: 0 }
  );

  return [totals.lng / usable.length, totals.lat / usable.length];
}

function pointInLngLatRing(point: LngLat, ring: LngLat[]) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

function shuffleCentroids(centroids: LngLat[]) {
  const shuffled = [...centroids];
  const rng = mulberry(13);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function source(map: MapboxMap, id: string) {
  return map.getSource(id) as GeoJSONSource | undefined;
}

function Beat3Map({
  copy,
  center,
  company,
  city,
}: {
  copy: BeatCopy;
  center: LngLat;
  company?: string;
  city?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const animationRef = useRef<number | null>(null);
  const hasInitializedRef = useRef(false);
  const buildingLayerIdRef = useRef<string | null>(null);
  const ringRef = useRef<LngLat[]>([]);
  const centroidsRef = useRef<LngLat[]>([]);
  const reducedRef = useRef(false);
  const [count, setCount] = useState('0');
  const [homeCount, setHomeCount] = useState(0);
  const [timer, setTimer] = useState('00.0 s');
  const [settled, setSettled] = useState(false);
  const [fallback, setFallback] = useState(false);
  const label = mapPersonalizationLabel(company, city);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const setPointData = useCallback((points: LngLat[], freshStart: number) => {
    const map = mapRef.current;
    if (!map) return;

    source(map, POINTS_SOURCE_ID)?.setData({
      type: 'FeatureCollection',
      features: points.map((point, index) => pointFeature(point, index, index >= freshStart)),
    });
  }, []);

  const queryBuildingCentroids = useCallback(() => {
    const map = mapRef.current;
    const buildingLayerId = buildingLayerIdRef.current;
    if (!map || !buildingLayerId) return [];

    const screenPolygon = ringRef.current.map((coord) => map.project(coord));
    const screenBounds = screenPolygon.reduce(
      (acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxX: Math.max(acc.maxX, point.x),
        maxY: Math.max(acc.maxY, point.y),
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      }
    );
    const queryBounds: [PointLike, PointLike] = [
      [screenBounds.minX, screenBounds.minY],
      [screenBounds.maxX, screenBounds.maxY],
    ];
    const queryRenderedFeatures = map.queryRenderedFeatures.bind(map) as unknown as (
      geometry: [PointLike, PointLike],
      options: { layers: string[] }
    ) => MapboxGeoJSONFeature[];
    const features = queryRenderedFeatures(queryBounds, { layers: [buildingLayerId] });
    const unique = new Map<string, LngLat>();

    for (const feature of features) {
      const centroid = featureCentroid(feature);
      if (!centroid) continue;
      if (!pointInLngLatRing(centroid, ringRef.current)) continue;

      const key = String(feature.id ?? feature.properties?.id ?? feature.properties?.mapbox_id ?? centroid.join(','));
      unique.set(key, centroid);
    }

    return shuffleCentroids([...unique.values()]);
  }, []);

  const runSequence = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    cancelAnimation();
    const ring = ringRef.current;
    source(map, POLYGON_SOURCE_ID)?.setData(emptyFeatureCollection());
    source(map, POINTS_SOURCE_ID)?.setData(emptyFeatureCollection());
    setCount('0');
    setHomeCount(0);
    setTimer('00.0 s');
    setSettled(false);

    const polygonSource = source(map, POLYGON_SOURCE_ID);
    if (!polygonSource) return;
    const polygonGeoJsonSource = polygonSource;

    const drawDur = reducedRef.current ? 0 : 1100;
    const cascadeDur = reducedRef.current ? 0 : 2600;

    if (reducedRef.current) {
      polygonGeoJsonSource.setData({
        type: 'FeatureCollection',
        features: [polygonFeature(ring), lineFeature([...ring, ring[0]])],
      });
      const centroids = queryBuildingCentroids();
      centroidsRef.current = centroids;
      setPointData(centroids, Math.max(0, centroids.length - 40));
      setCount(centroids.length.toLocaleString());
      setHomeCount(centroids.length);
      setTimer(copy.b3FinalTimer);
      setSettled(true);
      return;
    }

    const start = performance.now();
    let queried = false;
    let centroids: LngLat[] = [];

    function frame(now: number) {
      const t = now - start;
      const sp = Math.min(1, t / drawDur);
      const partialLine = interpolateRing(ring, sp);

      polygonGeoJsonSource.setData({
        type: 'FeatureCollection',
        features: [
          ...(sp >= 1 ? [polygonFeature(ring)] : []),
          lineFeature(partialLine),
        ],
      });

      if (sp >= 1 && !queried) {
        queried = true;
        centroids = queryBuildingCentroids();
        centroidsRef.current = centroids;
      }

      const cp = Math.max(0, Math.min(1, (t - drawDur) / cascadeDur));
      const eased = 1 - Math.pow(1 - cp, 3);
      const n = Math.floor(centroids.length * eased);
      setPointData(centroids.slice(0, n), Math.max(0, n - 40));
      setCount(n.toLocaleString());
      setTimer((Math.min(t, drawDur + cascadeDur) / 100).toFixed(1).padStart(4, '0') + ' s · unit splits included');

      if (t < drawDur + cascadeDur + 200) {
        animationRef.current = requestAnimationFrame(frame);
      } else {
        animationRef.current = null;
        setPointData(centroids, Math.max(0, centroids.length - 40));
        setCount(centroids.length.toLocaleString());
        setHomeCount(centroids.length);
        setTimer(copy.b3FinalTimer);
        setSettled(true);
      }
    }

    animationRef.current = requestAnimationFrame(frame);
  }, [cancelAnimation, copy.b3FinalTimer, queryBuildingCentroids, setPointData]);

  const initializeMap = useCallback(async () => {
    if (hasInitializedRef.current || !mapContainerRef.current) return;

    hasInitializedRef.current = true;

    try {
      reducedRef.current = getInitialReducedMotion();
      const [mapboxglModule, style] = await Promise.all([getMapboxGl(), getDemoStandardLightMapStyle()]);
      const mapboxgl = mapboxglModule.default ?? mapboxglModule;
      const buildingLayerId = findDemoBuildingLayerId(style);

      if (!buildingLayerId) {
        throw new Error('Demo map style did not expose a building layer.');
      }

      buildingLayerIdRef.current = buildingLayerId;
      ringRef.current = buildTerritoryRing(center, territoryRadiusMeters(center, mapContainerRef.current));

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        center: center as LngLatLike,
        zoom: TARGET_ZOOM,
        pitch: 0,
        bearing: 0,
        interactive: false,
        attributionControl: false,
        style,
      });
      mapRef.current = map;

      map.once('load', () => {
        try {
          if (!map.getLayer(buildingLayerId)) {
            throw new Error(`Building layer "${buildingLayerId}" was not available after style load.`);
          }

          map.addSource(POLYGON_SOURCE_ID, {
            type: 'geojson',
            data: emptyFeatureCollection(),
          });
          map.addSource(POINTS_SOURCE_ID, {
            type: 'geojson',
            data: emptyFeatureCollection(),
          });
          map.addLayer({
            id: POLYGON_FILL_LAYER_ID,
            type: 'fill',
            source: POLYGON_SOURCE_ID,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
              'fill-color': '#ff4d00',
              'fill-opacity': 0.06,
            },
          });
          map.addLayer({
            id: POLYGON_LINE_LAYER_ID,
            type: 'line',
            source: POLYGON_SOURCE_ID,
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: {
              'line-color': '#ff4d00',
              'line-width': 2.5,
              'line-dasharray': [8, 5],
            },
          });
          map.addLayer({
            id: POINTS_LAYER_ID,
            type: 'circle',
            source: POINTS_SOURCE_ID,
            paint: {
              'circle-radius': 2,
              'circle-color': ADDRESS_HIGHLIGHT_COLOR,
              'circle-opacity': 0.96,
            },
          });
          map.addLayer({
            id: FRESH_POINTS_LAYER_ID,
            type: 'circle',
            source: POINTS_SOURCE_ID,
            filter: ['==', ['get', 'fresh'], true],
            paint: {
              'circle-radius': 3.5,
              'circle-color': ADDRESS_HIGHLIGHT_COLOR,
              'circle-opacity': 0.96,
            },
          });

          map.setCenter(center as LngLatLike);
          map.setZoom(TARGET_ZOOM);
          map.once('idle', runSequence);
        } catch (error) {
          console.error('[Beat3] Falling back to canvas after map setup failed:', error);
          setFallback(true);
        }
      });

      map.once('error', (event) => {
        console.error('[Beat3] Falling back to canvas after map error:', event.error);
        setFallback(true);
      });
    } catch (error) {
      console.error('[Beat3] Falling back to canvas after Mapbox load failed:', error);
      setFallback(true);
    }
  }, [center, runSequence]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void initializeMap();
        }
      },
      { threshold: 0.45 }
    );

    observer.observe(stage);

    return () => {
      observer.disconnect();
    };
  }, [initializeMap]);

  useEffect(() => {
    return () => {
      cancelAnimation();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [cancelAnimation]);

  if (fallback) {
    return <Beat3Canvas copy={copy} />;
  }

  return (
    <section id="b3" className="light">
      <div className="rv eyebrow">Beat 03 · Territory</div>
      <h2 className="h-big rv d1">{renderLines(copy.b3Headline)}</h2>
      <p className="sub rv d2">{copy.b3Sub}</p>
      <div className="stage demo-map-stage demo-campaign-detail-stage rv d3" id="stage3" ref={stageRef}>
        <div className="demo-campaign-map-area">
          <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />
          {label ? <div className="demo-map-label">{label}</div> : null}
          <button
            className="replay"
            id="replay3"
            type="button"
            onClick={() => {
              track('replay', 3);
              runSequence();
            }}
          >
            {copy.b3ReplayLabel}
          </button>
          <div className="hud demo-map-hud">
            <div className="counter demo-map-counter">
              <span id="count3">{count}</span>
              <small>{copy.b3CounterLabel}</small>
            </div>
            <div id="time3">{timer}</div>
          </div>
        </div>
        <div className={`demo-campaign-detail-panel${settled ? ' is-visible' : ''}`} aria-hidden={!settled}>
          <div className="demo-campaign-quality-banner">
            <span className="demo-campaign-quality-badge">Data Quality 95</span>
            <p>Address and building coverage are within target thresholds.</p>
          </div>
          <div className="demo-campaign-stat-grid">
            <div className="demo-campaign-stat-card">
              <div className="demo-campaign-stat-label">Total homes</div>
              <div className="demo-campaign-stat-value">{homeCount.toLocaleString()}</div>
              <div className="demo-campaign-stat-note">addresses in campaign</div>
            </div>
            <div className="demo-campaign-stat-card">
              <div className="demo-campaign-stat-label">Leads</div>
              <div className="demo-campaign-stat-value">0</div>
              <div className="demo-campaign-stat-note">contacts in campaign</div>
            </div>
            <div className="demo-campaign-stat-card">
              <div className="demo-campaign-stat-label">Visited</div>
              <div className="demo-campaign-stat-value demo-campaign-stat-positive">0%</div>
              <div className="demo-campaign-stat-note">0% of houses</div>
            </div>
            <div className="demo-campaign-stat-card">
              <div className="demo-campaign-stat-label">Scan Rate</div>
              <div className="demo-campaign-stat-value demo-campaign-stat-positive">0%</div>
              <div className="demo-campaign-stat-note">0 scanned</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Beat3({
  copy,
  center,
  company,
  city,
}: {
  copy: BeatCopy;
  center?: LngLat;
  company?: string;
  city?: string;
}) {
  if (!center) {
    return <Beat3Canvas copy={copy} />;
  }

  return <Beat3Map copy={copy} center={center} company={company} city={city} />;
}
