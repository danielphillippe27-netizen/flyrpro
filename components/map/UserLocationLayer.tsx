'use client';

import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Map } from 'mapbox-gl';
import { createRoot } from 'react-dom/client';
import { LocationMarker } from './LocationMarker';

const MARKER_SIZE = 48;

export interface UserLocationLayerProps {
  map: Map | null;
  mapLoaded: boolean;
  /** When true, request geolocation and show the location marker. */
  showUserLocation: boolean;
  /** Called when user location is shown (e.g. to center map). */
  onLocationFound?: (lng: number, lat: number) => void;
  /** Called when geolocation fails. */
  onLocationError?: (error: GeolocationPositionError) => void;
}

export function UserLocationLayer({
  map,
  mapLoaded,
  showUserLocation,
  onLocationFound,
  onLocationError,
}: UserLocationLayerProps) {
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const rootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  const clearMarker = useCallback(() => {
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    if (rootRef.current && elRef.current) {
      rootRef.current.unmount();
      rootRef.current = null;
      elRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!showUserLocation || !map || !mapLoaded) {
      clearMarker();
      return;
    }

    if (!navigator.geolocation) {
      onLocationError?.(Object.assign(new Error('Geolocation not supported') as any, { code: 2, message: 'Geolocation not supported' }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        if (!map) return;

        clearMarker();

        const el = document.createElement('div');
        el.className = 'user-location-marker';
        el.style.cursor = 'default';
        elRef.current = el;

        const root = createRoot(el);
        rootRef.current = root;
        root.render(<LocationMarker size={MARKER_SIZE} />);

        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([longitude, latitude])
          .addTo(map);

        markerRef.current = marker;
        onLocationFound?.(longitude, latitude);
      },
      (err) => {
        onLocationError?.(err);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );

    return () => {
      clearMarker();
    };
  }, [showUserLocation, map, mapLoaded, onLocationFound, onLocationError, clearMarker]);

  return null;
}
