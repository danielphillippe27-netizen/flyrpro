'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { createRoot, type Root } from 'react-dom/client';
import type { PublicBeaconPayload } from '@/lib/beacon/public';
import { getMapboxToken } from '@/lib/mapbox';
import { LocationMarker } from '@/components/map/LocationMarker';

const DEFAULT_CENTER: [number, number] = [-79.3832, 43.6532];
const DEFAULT_ZOOM = 14;
const MAP_STYLE = process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID;
const BEACON_PINS_SOURCE_ID = 'beacon-session-pins';
const BEACON_PINS_HALO_LAYER_ID = 'beacon-session-pins-halo';
const BEACON_PINS_LAYER_ID = 'beacon-session-pins-core';
const BEACON_PINS_LABEL_LAYER_ID = 'beacon-session-pins-label';

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

function emptyPinFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

function isManualPinDoor(door: NonNullable<PublicBeaconPayload['session_doors']>[number]) {
  const markers = [
    door.feature_type,
    door.source,
    door.address_provenance,
    door.event_type,
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);

  return markers.some((value) => value === 'manual_pin' || value === 'field_manual_pin');
}

function buildPinFeatureCollection(payload: PublicBeaconPayload): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: (payload.session_doors ?? [])
      .filter((door) => isValidCoordinate(door.lat, door.lon))
      .map((door) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [door.lon, door.lat],
        },
        properties: {
          address_id: door.address_id,
          formatted: door.formatted ?? null,
          house_number: door.house_number ?? null,
          street_name: door.street_name ?? null,
          status: door.status ?? 'none',
          map_status: door.map_status ?? 'not_visited',
          is_manual_pin: isManualPinDoor(door),
          created_at: door.created_at,
        },
      })),
  };
}

function ensurePinLayers(map: mapboxgl.Map) {
  if (!map.getSource(BEACON_PINS_SOURCE_ID)) {
    map.addSource(BEACON_PINS_SOURCE_ID, {
      type: 'geojson',
      data: emptyPinFeatureCollection(),
    });
  }

  if (!map.getLayer(BEACON_PINS_HALO_LAYER_ID)) {
    map.addLayer({
      id: BEACON_PINS_HALO_LAYER_ID,
      type: 'circle',
      source: BEACON_PINS_SOURCE_ID,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'is_manual_pin'], true], 17, 12],
        'circle-color': ['case', ['==', ['get', 'is_manual_pin'], true], '#facc15', '#ffffff'],
        'circle-opacity': ['case', ['==', ['get', 'is_manual_pin'], true], 0.34, 0.22],
      },
    });
  }

  if (!map.getLayer(BEACON_PINS_LAYER_ID)) {
    map.addLayer({
      id: BEACON_PINS_LAYER_ID,
      type: 'circle',
      source: BEACON_PINS_SOURCE_ID,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'is_manual_pin'], true], 9, 7],
        'circle-color': [
          'case',
          ['==', ['coalesce', ['get', 'map_status'], 'not_visited'], 'hot'], '#2563eb',
          ['==', ['coalesce', ['get', 'map_status'], 'not_visited'], 'hot_lead'], '#2563eb',
          ['==', ['coalesce', ['get', 'map_status'], 'not_visited'], 'lead'], '#2563eb',
          ['==', ['coalesce', ['get', 'map_status'], 'not_visited'], 'appointment'], '#facc15',
          ['==', ['coalesce', ['get', 'map_status'], 'not_visited'], 'future_seller'], '#facc15',
          ['==', ['coalesce', ['get', 'map_status'], 'not_visited'], 'follow_up'], '#facc15',
          ['==', ['coalesce', ['get', 'map_status'], 'not_visited'], 'no_answer'], '#f97316',
          ['==', ['coalesce', ['get', 'map_status'], 'not_visited'], 'do_not_knock'], '#9ca3af',
          ['==', ['coalesce', ['get', 'map_status'], 'not_visited'], 'visited'], '#22c55e',
          '#ef4444',
        ],
        'circle-stroke-width': ['case', ['==', ['get', 'is_manual_pin'], true], 4, 2],
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 1,
      },
    });
  }

  if (!map.getLayer(BEACON_PINS_LABEL_LAYER_ID)) {
    map.addLayer({
      id: BEACON_PINS_LABEL_LAYER_ID,
      type: 'symbol',
      source: BEACON_PINS_SOURCE_ID,
      filter: ['==', ['get', 'is_manual_pin'], true],
      layout: {
        'text-field': '⌖',
        'text-size': 14,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#111827',
      },
    });
  }
}

function syncPinData(map: mapboxgl.Map, payload: PublicBeaconPayload) {
  if (!map.isStyleLoaded()) return;
  ensurePinLayers(map);
  const source = map.getSource(BEACON_PINS_SOURCE_ID);
  if (source && source.type === 'geojson') {
    source.setData(buildPinFeatureCollection(payload));
  }
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
  const payloadRef = useRef(payload);
  const hasCenteredRef = useRef(false);
  const lastCoordinateKeyRef = useRef<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  payloadRef.current = payload;

  const coordinate = useMemo(() => getLatestCoordinate(payload), [payload]);
  const pinCoordinateBounds = useMemo(
    () => (payload.session_doors ?? [])
      .filter((door) => isValidCoordinate(door.lat, door.lon))
      .map((door) => [door.lon, door.lat] as [number, number]),
    [payload]
  );

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
    if (!token || !MAP_STYLE) {
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
      syncPinData(map, payloadRef.current);
    });

    map.on('style.load', () => {
      hideBuildingLayers(map);
      syncPinData(map, payloadRef.current);
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
    syncPinData(map, payload);
  }, [payload]);

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
      if (pinCoordinateBounds.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend(coordinate);
        pinCoordinateBounds.forEach((pin) => bounds.extend(pin));
        map.fitBounds(bounds, {
          padding: 52,
          maxZoom: DEFAULT_ZOOM,
          duration: 0,
        });
      } else {
        map.jumpTo({ center: coordinate, zoom: DEFAULT_ZOOM });
      }
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
  }, [clearMarker, coordinate, pinCoordinateBounds]);

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
