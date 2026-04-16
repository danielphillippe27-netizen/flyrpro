'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { createRoot, type Root } from 'react-dom/client';
import type { PublicBeaconPayload } from '@/lib/beacon/public';
import { getMapboxToken } from '@/lib/mapbox';
import { LocationMarker } from '@/components/map/LocationMarker';

const DEFAULT_CENTER: [number, number] = [-79.3832, 43.6532];
const DEFAULT_ZOOM = 14;
const MAP_STYLE = 'mapbox://styles/mapbox/streets-v12';

type Props = {
  payload: PublicBeaconPayload;
};

function isValidCoordinate(lat: number, lon: number) {
  return Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= -90
    && lat <= 90
    && lon >= -180
    && lon <= 180;
}

function getLatestCoordinate(payload: PublicBeaconPayload): [number, number] | null {
  const latest = payload.latest_heartbeat;
  if (latest && isValidCoordinate(latest.lat, latest.lon)) {
    return [latest.lon, latest.lat];
  }

  const lastBreadcrumb = payload.breadcrumbs?.[payload.breadcrumbs.length - 1];
  if (lastBreadcrumb && isValidCoordinate(lastBreadcrumb.lat, lastBreadcrumb.lon)) {
    return [lastBreadcrumb.lon, lastBreadcrumb.lat];
  }

  return null;
}

function hideBuildingLayers(map: mapboxgl.Map) {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (layer.id.toLowerCase().includes('building')) {
      try {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      } catch {
        // Ignore layers that do not support layout visibility changes.
      }
    }
  }
}

export function BeaconLiveMap({ payload }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const markerElementRef = useRef<HTMLDivElement | null>(null);
  const markerRootRef = useRef<Root | null>(null);
  const hasCenteredRef = useRef(false);
  const lastCoordinateKeyRef = useRef<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const coordinate = useMemo(() => getLatestCoordinate(payload), [payload]);

  const clearMarker = useCallback(() => {
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    if (markerRootRef.current) {
      markerRootRef.current.unmount();
      markerRootRef.current = null;
    }
    markerElementRef.current = null;
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const token = getMapboxToken();
    if (!token) {
      setMapError('Map unavailable right now.');
      return;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: coordinate ?? DEFAULT_CENTER,
      zoom: coordinate ? DEFAULT_ZOOM : 10,
      attributionControl: true,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
    });

    map.on('load', () => {
      hideBuildingLayers(map);
    });

    map.on('style.load', () => {
      hideBuildingLayers(map);
    });

    mapRef.current = map;

    return () => {
      clearMarker();
      map.remove();
      mapRef.current = null;
      hasCenteredRef.current = false;
      lastCoordinateKeyRef.current = null;
    };
  }, [clearMarker, coordinate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!coordinate) {
      clearMarker();
      lastCoordinateKeyRef.current = null;
      return;
    }

    const nextCoordinateKey = coordinate.join(',');

    if (!markerRef.current) {
      const element = document.createElement('div');
      element.style.pointerEvents = 'none';
      markerElementRef.current = element;

      const root = createRoot(element);
      markerRootRef.current = root;
      root.render(<LocationMarker size={48} />);

      markerRef.current = new mapboxgl.Marker({
        element,
        anchor: 'center',
      })
        .setLngLat(coordinate)
        .addTo(map);
    } else {
      markerRef.current.setLngLat(coordinate);
    }

    if (!hasCenteredRef.current) {
      map.jumpTo({ center: coordinate, zoom: DEFAULT_ZOOM });
      hasCenteredRef.current = true;
      lastCoordinateKeyRef.current = nextCoordinateKey;
      return;
    }

    if (lastCoordinateKeyRef.current === nextCoordinateKey) {
      return;
    }

    map.easeTo({
      center: coordinate,
      duration: 1200,
      essential: true,
    });
    lastCoordinateKeyRef.current = nextCoordinateKey;
  }, [clearMarker, coordinate]);

  if (mapError) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-white/10 bg-white/6 px-6 text-center text-sm text-white/72">
        {mapError}
      </div>
    );
  }

  if (!coordinate) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-white/10 bg-white/6 px-6 text-center text-sm text-white/72">
        Waiting for the first live location update.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <div ref={mapContainerRef} className="h-[320px] w-full" />
    </div>
  );
}
