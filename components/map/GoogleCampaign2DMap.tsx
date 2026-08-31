'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CampaignAddress } from '@/types/database';
import {
  getStandardModeGoogleMapsApiKey,
  loadGoogleMapsLibrary,
} from '@/lib/google-maps';

type GoogleCampaign2DMapProps = {
  addresses: CampaignAddress[];
  boundary?: GeoJSON.Polygon | null;
  bbox?: [number, number, number, number] | null;
  theme: 'light' | 'dark';
  onReady?: () => void;
  onError?: (message: string) => void;
  onAddressClick: (target: { addressId: string; buildingId: string | null }) => void;
};

function pointCoordinate(address: CampaignAddress): [number, number] | null {
  if (address.coordinate) {
    const lon = Number(address.coordinate.lon);
    const lat = Number(address.coordinate.lat);
    if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat];
  }

  const candidate = address as CampaignAddress & {
    geom_json?: unknown;
    geometry?: unknown;
  };
  for (const value of [candidate.geom_json, candidate.geometry, address.geom]) {
    try {
      const geometry = typeof value === 'string' ? JSON.parse(value) : value;
      if (geometry && typeof geometry === 'object') {
        const point = geometry as { type?: unknown; coordinates?: unknown };
        if (point.type === 'Point' && Array.isArray(point.coordinates)) {
          const lon = Number(point.coordinates[0]);
          const lat = Number(point.coordinates[1]);
          if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat];
        }
      }
    } catch {
      // Try the next stored geometry representation.
    }
  }
  return null;
}

function statusColor(address: CampaignAddress): string {
  const status = String(address.address_status ?? '').toLowerCase();
  if (['hot_lead', 'lead'].includes(status)) return '#2563eb';
  if (['appointment', 'future_seller', 'follow_up'].includes(status)) return '#facc15';
  if (['talked', 'interested'].includes(status)) return '#22c55e';
  if (['no_answer', 'visited', 'delivered'].includes(status)) return '#f87171';
  if (['do_not_knock', 'dnc'].includes(status)) return '#050505';
  return '#ef4444';
}

function addressBuildingId(address: CampaignAddress): string | null {
  const candidate = address as CampaignAddress & {
    building_id?: unknown;
    building_gers_id?: unknown;
  };
  const value = candidate.building_id ?? candidate.building_gers_id ?? address.gers_id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function GoogleCampaign2DMap({
  addresses,
  boundary,
  bbox,
  theme,
  onReady,
  onError,
  onAddressClick,
}: GoogleCampaign2DMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const dataLayerRef = useRef<google.maps.Data | null>(null);
  const fittedRef = useRef(false);
  const dataRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const onAddressClickRef = useRef(onAddressClick);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  onAddressClickRef.current = onAddressClick;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const geoJson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: [
      ...(boundary
        ? [{
            type: 'Feature' as const,
            geometry: boundary,
            properties: { kind: 'boundary' },
          }]
        : []),
      ...addresses.flatMap((address) => {
        const coordinate = pointCoordinate(address);
        if (!coordinate) return [];
        return [{
          type: 'Feature' as const,
          id: address.id,
          geometry: { type: 'Point' as const, coordinates: coordinate },
          properties: {
            kind: 'address',
            addressId: address.id,
            buildingId: addressBuildingId(address),
            color: statusColor(address),
          },
        }];
      }),
    ],
  }), [addresses, boundary]);
  dataRef.current = geoJson;

  const syncData = useCallback(() => {
    const map = mapRef.current;
    const dataLayer = dataLayerRef.current;
    if (!map || !dataLayer) return;
    dataLayer.forEach((feature) => dataLayer.remove(feature));
    dataLayer.addGeoJson(dataRef.current);

    if (fittedRef.current) return;
    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;
    for (const feature of dataRef.current.features) {
      if (feature.geometry.type !== 'Point') continue;
      bounds.extend({ lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] });
      hasBounds = true;
    }
    if (!hasBounds && boundary) {
      for (const coordinate of boundary.coordinates[0] ?? []) {
        bounds.extend({ lat: coordinate[1], lng: coordinate[0] });
        hasBounds = true;
      }
    }
    if (!hasBounds && bbox) {
      bounds.extend({ lat: bbox[1], lng: bbox[0] });
      bounds.extend({ lat: bbox[3], lng: bbox[2] });
      hasBounds = true;
    }
    if (hasBounds) {
      fittedRef.current = true;
      map.fitBounds(bounds, 64);
    }
  }, [bbox, boundary]);

  useEffect(() => {
    syncData();
  }, [geoJson, syncData]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let clickListener: google.maps.MapsEventListener | null = null;

    const initialize = async () => {
      try {
        if (!getStandardModeGoogleMapsApiKey().trim()) {
          throw new Error('Google Maps is not configured for standard mode');
        }
        const [{ Map, MapTypeId }, { ColorScheme }] = await Promise.all([
          loadGoogleMapsLibrary('maps') as Promise<google.maps.MapsLibrary>,
          loadGoogleMapsLibrary('core') as Promise<google.maps.CoreLibrary>,
        ]);
        if (cancelled || !containerRef.current) return;

        const map = new Map(containerRef.current, {
          center: { lat: 43.6532, lng: -79.3832 },
          zoom: 15,
          colorScheme: theme === 'dark' ? ColorScheme.DARK : ColorScheme.LIGHT,
          mapTypeId: MapTypeId.ROADMAP,
          mapTypeControl: true,
          mapTypeControlOptions: { mapTypeIds: [MapTypeId.ROADMAP, MapTypeId.HYBRID] },
          streetViewControl: false,
          fullscreenControl: false,
          rotateControl: false,
          tilt: 0,
          clickableIcons: false,
        });
        mapRef.current = map;

        const dataLayer = new google.maps.Data({ map });
        dataLayerRef.current = dataLayer;
        dataLayer.setStyle((feature) => {
          if (feature.getProperty('kind') === 'boundary') {
            return {
              fillColor: '#ef4444',
              fillOpacity: 0.08,
              strokeColor: '#ef4444',
              strokeOpacity: 0.9,
              strokeWeight: 3,
              clickable: false,
            };
          }
          return {
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: String(feature.getProperty('color') ?? '#ef4444'),
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeOpacity: 1,
              strokeWeight: 2,
              scale: 7,
            },
            clickable: true,
          };
        });
        clickListener = dataLayer.addListener('click', (event: google.maps.Data.MouseEvent) => {
          if (event.feature.getProperty('kind') !== 'address') return;
          const addressId = String(event.feature.getProperty('addressId') ?? '');
          if (!addressId) return;
          const buildingValue = event.feature.getProperty('buildingId');
          onAddressClickRef.current({
            addressId,
            buildingId: typeof buildingValue === 'string' && buildingValue ? buildingValue : null,
          });
        });
        syncData();
        onReadyRef.current?.();
      } catch (error) {
        if (!cancelled) {
          onErrorRef.current?.(error instanceof Error ? error.message : 'Google Maps failed to load');
        }
      }
    };

    void initialize();
    return () => {
      cancelled = true;
      clickListener?.remove();
      dataLayerRef.current?.setMap(null);
      dataLayerRef.current = null;
      mapRef.current = null;
      fittedRef.current = false;
      container.innerHTML = '';
    };
  }, [syncData, theme]);

  return <div ref={containerRef} className="h-full w-full" aria-label="Campaign 2D map" />;
}
