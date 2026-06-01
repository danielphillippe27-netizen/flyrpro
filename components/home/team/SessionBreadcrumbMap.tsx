'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '@/lib/mapbox';
import { useMapStyle } from '@/lib/map-style-provider';
import { useTheme } from '@/lib/theme-provider';
import { applyPresetVisualTweaks, getResolvedMapInitOptions, resolveMapStyle } from '@/lib/map-styles';

const SOURCE_ID = 'session-breadcrumb';
const LINE_LAYER_ID = 'session-breadcrumb-line';
const POINTS_LAYER_ID = 'session-breadcrumb-points';

type SessionBreadcrumbMapProps = {
  pathGeojson: string | GeoJSON.LineString | null | undefined;
  color?: string;
};

function parseLineString(raw: string | GeoJSON.LineString | null | undefined): GeoJSON.LineString | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as GeoJSON.Geometry) : raw;
    if (parsed?.type === 'LineString' && Array.isArray(parsed.coordinates) && parsed.coordinates.length >= 2) {
      return parsed as GeoJSON.LineString;
    }
  } catch {
    return null;
  }
  return null;
}

function pointFeatures(route: GeoJSON.LineString): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const first = route.coordinates[0];
  const last = route.coordinates[route.coordinates.length - 1];
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'start' },
        geometry: { type: 'Point', coordinates: first },
      },
      {
        type: 'Feature',
        properties: { kind: 'end' },
        geometry: { type: 'Point', coordinates: last },
      },
    ],
  };
}

export function SessionBreadcrumbMap({ pathGeojson, color = '#2563EB' }: SessionBreadcrumbMapProps) {
  const { theme } = useTheme();
  const { preset } = useMapStyle();
  const route = useMemo(() => parseLineString(pathGeojson), [pathGeojson]);
  const resolvedMapStyle = useMemo(() => resolveMapStyle(preset, theme, 'v12'), [preset, theme]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || !route) return;
    let cancelled = false;

    const initMap = async () => {
      const token = getMapboxToken();
      if (!token) {
        setError('Map unavailable right now.');
        return;
      }

      mapboxgl.accessToken = token;
      const mapInitOptions = await getResolvedMapInitOptions(resolvedMapStyle);
      if (cancelled || !mapContainerRef.current) return;

      const first = route.coordinates[0];
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        ...mapInitOptions,
        center: first as [number, number],
        zoom: 15,
      });
      mapRef.current = map;

      map.on('load', () => {
        if (cancelled || !mapRef.current) return;
        applyPresetVisualTweaks(mapRef.current, resolvedMapStyle, {
          preserveLayerPrefixes: ['session-breadcrumb'],
        });

        const line: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: route,
            },
          ],
        };

        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: line,
        });
        map.addLayer({
          id: LINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': color,
            'line-width': 5,
            'line-opacity': 0.88,
          },
        });

        map.addSource(`${SOURCE_ID}-points`, {
          type: 'geojson',
          data: pointFeatures(route),
        });
        map.addLayer({
          id: POINTS_LAYER_ID,
          type: 'circle',
          source: `${SOURCE_ID}-points`,
          paint: {
            'circle-radius': 6,
            'circle-color': ['match', ['get', 'kind'], 'start', '#22C55E', 'end', '#EF4444', color],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          },
        });

        const bounds = new mapboxgl.LngLatBounds();
        route.coordinates.forEach((coordinate) => bounds.extend(coordinate as [number, number]));
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 44, maxZoom: 17, duration: 0 });
        }
      });
    };

    void initMap();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [color, resolvedMapStyle, route]);

  if (!route) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/10 text-sm text-muted-foreground">
        No GPS breadcrumb captured for this session.
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      <div ref={mapContainerRef} className="h-72 w-full" />
      {error ? (
        <div className="absolute inset-x-4 top-4 rounded-lg bg-background/90 px-3 py-2 text-sm text-destructive shadow">
          {error}
        </div>
      ) : null}
    </div>
  );
}
