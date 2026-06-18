'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, LngLatLike, Map as MapboxMap } from 'mapbox-gl';
import { buildCity, mulberry, type CityAddress, type DemoCity } from '@/lib/demo/canvas/cityModel';
import { getInitialReducedMotion } from '@/lib/demo/canvas/useReducedMotion';
import { track } from '@/lib/demo/analytics/track';
import { getDemoMapStyle } from '@/lib/demo/mapbox/demoMapStyle';
import { getMapboxGl } from '@/lib/demo/mapbox/loadMapboxGl';
import type { BeatCopy } from '@/lib/demo/payload';
import {
  Beat4Canvas,
  NAMES,
  OUTCOMES,
  OUTCOME_COLORS,
  STREETS,
  makePath,
  type OutcomeClass,
  type Rep,
  type RepName,
} from './Beat4Canvas';

type LngLat = [number, number];
type FeedLine = { id: number; className: OutcomeClass; text: string };

const TARGET_ZOOM = 15.5;
const ADDRESS_SOURCE_ID = 'demo-b4-address-source';
const FLIPS_SOURCE_ID = 'demo-b4-flips-source';
const TRAILS_SOURCE_ID = 'demo-b4-trails-source';
const REPS_SOURCE_ID = 'demo-b4-reps-source';
const ADDRESS_LAYER_ID = 'demo-b4-addresses';
const FLIPS_LAYER_ID = 'demo-b4-flips';
const TRAILS_LAYER_ID = 'demo-b4-trails';
const REP_PULSE_LAYER_ID = 'demo-b4-rep-pulse';
const REP_DOT_LAYER_ID = 'demo-b4-rep-dot';
const REP_LABEL_LAYER_ID = 'demo-b4-rep-label';
const LOOP_DIAMETER_METERS = 220;
const MIN_FRAME_MS = 16;
const MAX_FRAME_MS = 80;

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

function source(map: MapboxMap, id: string) {
  return map.getSource(id) as GeoJSONSource | undefined;
}

function metersPerPixelAtZoom(lat: number, zoom: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

function offsetMeters(center: LngLat, eastMeters: number, northMeters: number): LngLat {
  const latRad = (center[1] * Math.PI) / 180;
  const lngDelta = eastMeters / (111_320 * Math.max(Math.cos(latRad), 0.01));
  const latDelta = northMeters / 110_540;
  return [center[0] + lngDelta, center[1] + latDelta];
}

function syntheticMetersPerPixel(W: number, H: number, lat: number) {
  const mapMetersPerPixel = metersPerPixelAtZoom(lat, TARGET_ZOOM);
  const loopDiameterInMapPixels = LOOP_DIAMETER_METERS / mapMetersPerPixel;
  return (loopDiameterInMapPixels * mapMetersPerPixel) / Math.max(W, H);
}

function canvasPointToMeters(point: number[], center: LngLat, W: number, H: number) {
  const metersPerSyntheticPixel = syntheticMetersPerPixel(W, H, center[1]);
  return {
    east: (point[0] - W / 2) * metersPerSyntheticPixel,
    north: (H / 2 - point[1]) * metersPerSyntheticPixel,
  };
}

function canvasPointToLngLat(point: number[], center: LngLat, W: number, H: number): LngLat {
  const meters = canvasPointToMeters(point, center, W, H);
  return offsetMeters(center, meters.east, meters.north);
}

function segmentMeters(a: number[], b: number[], center: LngLat, W: number, H: number) {
  const am = canvasPointToMeters(a, center, W, H);
  const bm = canvasPointToMeters(b, center, W, H);
  return Math.hypot(bm.east - am.east, bm.north - am.north);
}

function addressFeatures(city: DemoCity, center: LngLat, W: number, H: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: city.addrs.map((address, index) => ({
      type: 'Feature',
      id: `addr-${index}`,
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: canvasPointToLngLat([address.x, address.y], center, W, H),
      },
    })),
  };
}

function flipFeatures(flips: { x: number; y: number; col: string }[], center: LngLat, W: number, H: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: flips.map((flip, index) => ({
      type: 'Feature',
      id: `flip-${index}`,
      properties: { color: flip.col },
      geometry: {
        type: 'Point',
        coordinates: canvasPointToLngLat([flip.x, flip.y], center, W, H),
      },
    })),
  };
}

function trailFeatures(reps: Rep[], center: LngLat, W: number, H: number): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: reps
      .filter((rep) => rep.trail.length > 1)
      .map((rep) => ({
        type: 'Feature',
        id: `trail-${rep.name}`,
        properties: { color: rep.col },
        geometry: {
          type: 'LineString',
          coordinates: rep.trail.map((point) => canvasPointToLngLat(point, center, W, H)),
        },
      })),
  };
}

function repFeatures(reps: Rep[], center: LngLat, W: number, H: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: reps
      .filter((rep) => typeof rep.x === 'number' && typeof rep.y === 'number')
      .map((rep) => ({
        type: 'Feature',
        id: `rep-${rep.name}`,
        properties: { color: rep.col, name: rep.name },
        geometry: {
          type: 'Point',
          coordinates: canvasPointToLngLat([rep.x ?? 0, rep.y ?? 0], center, W, H),
        },
      })),
  };
}

function pickOutcome() {
  let q = Math.random();
  let oc = OUTCOMES[0];

  for (const o of OUTCOMES) {
    if (q < o[2]) {
      oc = o;
      break;
    }
    q -= o[2];
  }

  return oc;
}

function nearestAddress(city: DemoCity, rep: Rep): CityAddress | null {
  let best: CityAddress | null = null;
  let bd = 1e9;

  for (const p of city.addrs) {
    const d = (p.x - (rep.x ?? 0)) ** 2 + (p.y - (rep.y ?? 0)) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }

  return best;
}

function Beat4Map({ copy, center }: { copy: BeatCopy; center: LngLat }) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const animationRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingMapRef = useRef<Promise<MapboxMap> | null>(null);
  const runningRef = useRef(false);
  const visibleRef = useRef(false);
  const reducedRef = useRef(false);
  const feedIdRef = useRef(0);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [scores, setScores] = useState<Record<RepName, number>>({ MARCUS: 0, DEVON: 0, PRIYA: 0, COLE: 0 });
  const [fallback, setFallback] = useState(false);

  const stopBeat4 = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    runningRef.current = false;
  }, []);

  const updateMapData = useCallback((reps: Rep[], flips: { x: number; y: number; col: string }[], W: number, H: number, now: number) => {
    const map = mapRef.current;
    if (!map) return;

    source(map, FLIPS_SOURCE_ID)?.setData(flipFeatures(flips, center, W, H));
    source(map, TRAILS_SOURCE_ID)?.setData(trailFeatures(reps, center, W, H));
    source(map, REPS_SOURCE_ID)?.setData(repFeatures(reps, center, W, H));
    map.setPaintProperty(REP_PULSE_LAYER_ID, 'circle-radius', 9 + Math.sin(now / 300) * 2);
  }, [center]);

  const initializeMap = useCallback(async () => {
    if (mapRef.current) return mapRef.current;
    if (loadingMapRef.current) return loadingMapRef.current;

    loadingMapRef.current = (async () => {
      if (!mapContainerRef.current) {
        throw new Error('Beat 4 map container unavailable.');
      }

      const [mapboxglModule, style] = await Promise.all([getMapboxGl(), getDemoMapStyle('dark')]);
      const mapboxgl = mapboxglModule.default ?? mapboxglModule;
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

      await new Promise<void>((resolve, reject) => {
        map.once('load', () => resolve());
        map.once('error', (event) => reject(event.error));
      });

      map.addSource(ADDRESS_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
      map.addSource(FLIPS_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
      map.addSource(TRAILS_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
      map.addSource(REPS_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
      map.addLayer({
        id: ADDRESS_LAYER_ID,
        type: 'circle',
        source: ADDRESS_SOURCE_ID,
        paint: {
          'circle-radius': 1.2,
          'circle-color': '#d9d5cb',
          'circle-opacity': 0.16,
        },
      });
      map.addLayer({
        id: FLIPS_LAYER_ID,
        type: 'circle',
        source: FLIPS_SOURCE_ID,
        paint: {
          'circle-radius': 3,
          'circle-color': ['get', 'color'],
          'circle-opacity': 1,
        },
      });
      map.addLayer({
        id: TRAILS_LAYER_ID,
        type: 'line',
        source: TRAILS_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': 0.42,
          'line-width': 2,
        },
      });
      map.addLayer({
        id: REP_PULSE_LAYER_ID,
        type: 'circle',
        source: REPS_SOURCE_ID,
        paint: {
          'circle-radius': 9,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 1,
        },
      });
      map.addLayer({
        id: REP_DOT_LAYER_ID,
        type: 'circle',
        source: REPS_SOURCE_ID,
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-opacity': 1,
        },
      });
      map.addLayer({
        id: REP_LABEL_LAYER_ID,
        type: 'symbol',
        source: REPS_SOURCE_ID,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 10,
          'text-offset': [1.45, 0.2],
          'text-anchor': 'left',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#d9d5cb',
          'text-halo-color': '#0c0c0a',
          'text-halo-width': 1.5,
        },
      });

      map.setCenter(center as LngLatLike);
      map.setZoom(TARGET_ZOOM);
      map.resize();
      return map;
    })();

    return loadingMapRef.current;
  }, [center]);

  const runBeat4 = useCallback(async () => {
    let map: MapboxMap;

    try {
      map = await initializeMap();
    } catch (error) {
      console.error('[Beat4] Falling back to canvas after Mapbox load failed:', error);
      setFallback(true);
      return;
    }

    if (!visibleRef.current || !stageRef.current) {
      return;
    }

    stopBeat4();
    runningRef.current = true;
    setFeed([]);
    setScores({ MARCUS: 0, DEVON: 0, PRIYA: 0, COLE: 0 });

    map.setCenter(center as LngLatLike);
    map.setZoom(TARGET_ZOOM);
    map.resize();

    const rect = stageRef.current.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const city = buildCity(W, H);
    const rng = mulberry(31);
    const reps: Rep[] = NAMES.map((n) => ({
      name: n[0],
      col: n[1],
      path: makePath(city, rng),
      seg: 0,
      f: 0,
      trail: [],
      speed: reducedRef.current ? 0 : 1.05 + rng() * 0.35,
    }));
    const flips: { x: number; y: number; col: string }[] = [];
    let previousFrameTime = performance.now();

    source(map, ADDRESS_SOURCE_ID)?.setData(addressFeatures(city, center, W, H));
    source(map, FLIPS_SOURCE_ID)?.setData(emptyFeatureCollection());
    source(map, TRAILS_SOURCE_ID)?.setData(emptyFeatureCollection());
    source(map, REPS_SOURCE_ID)?.setData(emptyFeatureCollection());

    function drawFrame(now: number) {
      const deltaSeconds = Math.max(MIN_FRAME_MS, Math.min(MAX_FRAME_MS, now - previousFrameTime)) / 1000;
      previousFrameTime = now;

      reps.forEach((r) => {
        if (!reducedRef.current) {
          let remainingMeters = r.speed * deltaSeconds;

          while (remainingMeters > 0) {
            const a = r.path[r.seg];
            const b = r.path[r.seg + 1];
            const distance = segmentMeters(a, b, center, W, H);

            if (distance <= 0) {
              r.f = 0;
              r.seg = (r.seg + 1) % (r.path.length - 1);
              continue;
            }

            const remainingOnSegment = (1 - r.f) * distance;
            if (remainingMeters < remainingOnSegment) {
              r.f += remainingMeters / distance;
              remainingMeters = 0;
            } else {
              remainingMeters -= remainingOnSegment;
              r.f = 0;
              r.seg = (r.seg + 1) % (r.path.length - 1);
            }
          }
        }
        const a = r.path[r.seg];
        const b = r.path[r.seg + 1];
        const x = a[0] + (b[0] - a[0]) * r.f;
        const y = a[1] + (b[1] - a[1]) * r.f;
        r.x = x;
        r.y = y;
        r.trail.push([x, y]);
        if (r.trail.length > 90) r.trail.shift();
      });

      updateMapData(reps, flips, W, H, now);
    }

    function step(now: number) {
      drawFrame(now);
      animationRef.current = requestAnimationFrame(step);
    }

    if (reducedRef.current) {
      drawFrame(performance.now());
    } else {
      animationRef.current = requestAnimationFrame(step);
    }

    timerRef.current = setInterval(() => {
      const ri = (Math.random() * reps.length) | 0;
      const r = reps[ri];
      const oc = pickOutcome();
      const best = nearestAddress(city, r);

      if (best) flips.push({ x: best.x, y: best.y, col: OUTCOME_COLORS[oc[1]] });
      if (flips.length > 400) flips.shift();

      const num = 20 + ((Math.random() * 240) | 0);
      const st = STREETS[(Math.random() * STREETS.length) | 0];
      const d = new Date();
      const text =
        String(d.getHours()).padStart(2, '0') +
        ':' +
        String(d.getMinutes()).padStart(2, '0') +
        ' · ' +
        num +
        ' ' +
        st.toUpperCase() +
        ' · ' +
        oc[0] +
        ' · ' +
        r.name;
      setFeed((current) => [...current, { id: feedIdRef.current++, className: oc[1], text }].slice(-9));
      setScores((current) => ({ ...current, [r.name]: current[r.name] + 1 }));
      source(map, FLIPS_SOURCE_ID)?.setData(flipFeatures(flips, center, W, H));
    }, reducedRef.current ? 999999 : 1300);
  }, [center, initializeMap, stopBeat4, updateMapData]);

  useEffect(() => {
    reducedRef.current = getInitialReducedMotion();
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0].isIntersecting;

        if (entries[0].isIntersecting && !runningRef.current) {
          void runBeat4();
        }
        if (!entries[0].isIntersecting && runningRef.current) {
          stopBeat4();
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(stage);

    return () => {
      observer.disconnect();
      stopBeat4();
    };
  }, [runBeat4, stopBeat4]);

  useEffect(() => {
    return () => {
      stopBeat4();
      mapRef.current?.remove();
      mapRef.current = null;
      loadingMapRef.current = null;
    };
  }, [stopBeat4]);

  if (fallback) {
    return <Beat4Canvas copy={copy} />;
  }

  return (
    <section id="b4">
      <div className="rv eyebrow">Beat 04 · Ground truth</div>
      <h2 className="h-big rv d1">{renderLines(copy.b4Headline)}</h2>
      <p className="sub rv d2">{copy.b4Sub}</p>
      <div className="grid4 rv d3">
        <div className="stage" id="stage4" ref={stageRef}>
          <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />
          <button
            className="replay"
            id="replay4"
            type="button"
            onClick={() => {
              track('replay', 4);
              void runBeat4();
            }}
          >
            {copy.b4ReplayLabel}
          </button>
        </div>
        <div className="panel">
          <h3>{copy.b4FeedTitle}</h3>
          <div className="feed" id="feed4" aria-live="off">
            {feed.map((line) => (
              <div className={line.className} key={line.id}>
                {line.text}
              </div>
            ))}
          </div>
          <div className="lb" id="lb4">
            {NAMES.map(([name, color]) => (
              <div className="row" key={name}>
                <b style={{ color }}>{name}</b>
                <span className="n">{scores[name]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Beat4({ copy, center }: { copy: BeatCopy; center?: LngLat }) {
  if (!center) {
    return <Beat4Canvas copy={copy} />;
  }

  return <Beat4Map copy={copy} center={center} />;
}
