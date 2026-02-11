'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Map } from 'mapbox-gl';
import { CampaignsService } from '@/lib/services/CampaignsService';

const SOURCE_ID = 'campaign-markers-source';
const LAYER_ID = 'campaign-markers-layer';
const MAX_CAMPAIGNS = 50;

export interface CampaignPoint {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

interface CampaignMarkersLayerProps {
  map: Map | null;
  mapLoaded: boolean;
  userId: string | null;
  selectedCampaignId: string | null;
  onCampaignSelect: (id: string | null) => void;
}

function buildGeoJSON(points: CampaignPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p) => ({
      type: 'Feature' as const,
      id: p.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [p.lng, p.lat],
      },
      properties: {
        campaignId: p.id,
        name: p.name,
      },
    })),
  };
}

export function CampaignMarkersLayer({
  map,
  mapLoaded,
  userId,
  selectedCampaignId,
  onCampaignSelect,
}: CampaignMarkersLayerProps) {
  const [campaignPoints, setCampaignPoints] = useState<CampaignPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const clickHandlerRef = useRef<((e: mapboxgl.MapLayerMouseEvent) => void) | null>(null);

  // Fetch campaigns and their centroids (limit 50)
  useEffect(() => {
    if (!userId || !mapLoaded) {
      setCampaignPoints([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const campaigns = await CampaignsService.fetchCampaignsV2(userId);
        const limited = campaigns.slice(0, MAX_CAMPAIGNS);

        const bboxes = await Promise.all(
          limited.map((c) => CampaignsService.fetchCampaignBoundingBox(c.id))
        );

        if (cancelled) return;

        const points: CampaignPoint[] = [];
        limited.forEach((c, i) => {
          const bbox = bboxes[i];
          if (!bbox) return;
          const lng = (bbox.minLon + bbox.maxLon) / 2;
          const lat = (bbox.minLat + bbox.maxLat) / 2;
          points.push({
            id: c.id,
            name: c.name,
            lng,
            lat,
          });
        });

        setCampaignPoints(points);
      } catch (err) {
        console.error('[CampaignMarkersLayer] Error fetching campaigns/bboxes:', err);
        if (!cancelled) setCampaignPoints([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, mapLoaded]);

  const addLayers = useCallback(() => {
    if (!map || !map.getStyle() || campaignPoints.length === 0) return;

    if (clickHandlerRef.current) {
      map.off('click', LAYER_ID, clickHandlerRef.current);
      clickHandlerRef.current = null;
    }

    const geojson = buildGeoJSON(campaignPoints);

    try {
      if (map.getSource(SOURCE_ID)) {
        (map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource).setData(geojson);
      } else {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: geojson,
          promoteId: 'campaignId',
        });
      }

      if (!map.getLayer(LAYER_ID)) {
        map.addLayer({
          id: LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': [
              'case',
              ['==', ['get', 'campaignId'], selectedCampaignId ?? ''],
              12,
              8,
            ],
            'circle-color': [
              'case',
              ['==', ['get', 'campaignId'], selectedCampaignId ?? ''],
              '#dc2626',
              '#ef4444',
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        });
      } else {
        map.setPaintProperty(LAYER_ID, 'circle-radius', [
          'case',
          ['==', ['get', 'campaignId'], selectedCampaignId ?? ''],
          12,
          8,
        ]);
        map.setPaintProperty(LAYER_ID, 'circle-color', [
          'case',
          ['==', ['get', 'campaignId'], selectedCampaignId ?? ''],
          '#dc2626',
          '#ef4444',
        ]);
      }

      const handler = (e: mapboxgl.MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature?.properties?.campaignId) return;
        const id = feature.properties.campaignId as string;
        if (id === selectedCampaignId) {
          onCampaignSelect(null);
        } else {
          onCampaignSelect(id);
        }
      };

      clickHandlerRef.current = handler;
      map.on('click', LAYER_ID, handler);
    } catch (err) {
      console.error('[CampaignMarkersLayer] Error adding source/layer:', err);
    }
  }, [map, campaignPoints, selectedCampaignId, onCampaignSelect]);

  // Add/update layer and re-add on style.load
  useEffect(() => {
    if (!map || !mapLoaded) return;

    const cleanup = () => {
      map.off('style.load', addLayers);
      if (clickHandlerRef.current) {
        map.off('click', LAYER_ID, clickHandlerRef.current);
        clickHandlerRef.current = null;
      }
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // Style may have been reset
      }
    };

    if (campaignPoints.length === 0) {
      cleanup();
      return;
    }

    addLayers();
    map.on('style.load', addLayers);

    return cleanup;
  }, [map, mapLoaded, campaignPoints, addLayers]);

  return null;
}
