'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { parseSessionRoute } from '@/lib/activity-session';
import { cn } from '@/lib/utils';
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
  className?: string;
  overlay?: ReactNode;
};

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

export function SessionBreadcrumbMap({ pathGeojson, color = '#2563EB', className, overlay }: SessionBreadcrumbMapProps) {
  const { theme } = useTheme();
  const { preset } = useMapStyle();
  const route = useMemo(() => parseSessionRoute(pathGeojson), [pathGeojson]);
  const resolvedMapStyle = useMemo(() => resolveMapStyle(preset, theme, 'v12'), [preset, theme]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || !route) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    setError(null);

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
        center: [first[0], first[1]],
        zoom: 15,
      });
      mapRef.current = map;
      if (overlayRef.current) {
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      }

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
        route.coordinates.forEach(([lng, lat]) => bounds.extend([lng, lat]));
        const fitRoute = () => {
          const bottom = overlayRef.current ? overlayRef.current.offsetHeight + 48 : 44;
          const height = map.getContainer().clientHeight;
          if (height <= bottom + 44) return;
          map.fitBounds(bounds, {
            padding: { top: 44, right: overlayRef.current ? 56 : 44, bottom, left: 44 },
            maxZoom: 17,
            duration: 0,
            retainPadding: false,
          });
        };
        fitRoute();
        if (overlayRef.current) {
          resizeObserver = new ResizeObserver(() => {
            map.resize();
            fitRoute();
          });
          resizeObserver.observe(map.getContainer());
          resizeObserver.observe(overlayRef.current);
        }
      });
    };

    void initMap().catch(() => {
      if (!cancelled) setError('Map unavailable right now.');
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
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
    <div className={cn('relative overflow-hidden rounded-xl border border-border bg-card', className)}>
      <div ref={mapContainerRef} className={cn('w-full', overlay ? 'h-full' : 'h-72')} />
      {overlay && (
        <div ref={overlayRef} className="pointer-events-none absolute inset-x-2 bottom-9 sm:inset-x-4">
          {overlay}
        </div>
      )}
      {error ? (
        <div className="absolute inset-x-4 top-4 rounded-lg bg-background/90 px-3 py-2 text-sm text-destructive shadow">
          {error}
        </div>
      ) : null}
    </div>
  );
}
