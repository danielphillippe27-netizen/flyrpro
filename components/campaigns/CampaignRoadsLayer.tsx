'use client';

import { useEffect } from 'react';
import type { Map } from 'mapbox-gl';
import { createClient } from '@/lib/supabase/client';

const ROADS_SOURCE_ID = 'campaign-roads-source';
const ROADS_LAYER_ID = 'campaign-roads-line';

export interface CampaignRoadsLayerProps {
  campaignId: string;
  map: Map;
  isMapReady: boolean;
  /** When this changes (e.g. after refresh), refetch roads from the server. */
  roadCacheVersion?: number | null;
}

/** Ensure each feature has `road_class` for Mapbox match expressions (RPC may use `class`). */
function normalizeRoadsGeoJSON(
  fc: GeoJSON.FeatureCollection
): GeoJSON.FeatureCollection {
  return {
    ...fc,
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const roadClass =
        typeof p.road_class === 'string'
          ? p.road_class
          : typeof p.class === 'string'
            ? p.class
            : 'unknown';
      return {
        ...f,
        properties: {
          ...p,
          road_class: roadClass,
        },
      };
    }),
  };
}

export function CampaignRoadsLayer({
  campaignId,
  map,
  isMapReady,
  roadCacheVersion,
}: CampaignRoadsLayerProps) {
  useEffect(() => {
    if (!isMapReady || !campaignId) return;

    const m = map;
    let cancelled = false;

    const removeRoads = () => {
      try {
        if (m.getStyle()?.layers && m.getLayer(ROADS_LAYER_ID)) m.removeLayer(ROADS_LAYER_ID);
        if (m.getStyle()?.sources && m.getSource(ROADS_SOURCE_ID)) m.removeSource(ROADS_SOURCE_ID);
      } catch {
        // style may be unloading
      }
    };

    const addRoadsLayer = (geojson: GeoJSON.FeatureCollection) => {
      if (!m.isStyleLoaded()) return;
      const normalized = normalizeRoadsGeoJSON(geojson);
      if (!normalized.features?.length) return;

      try {
        removeRoads();
        m.addSource(ROADS_SOURCE_ID, { type: 'geojson', data: normalized });
        const layers = m.getStyle().layers ?? [];
        const beforeId = layers.find(
          (l) => l.type === 'symbol' || l.id.includes('building')
        )?.id;

        m.addLayer(
          {
            id: ROADS_LAYER_ID,
            type: 'line',
            source: ROADS_SOURCE_ID,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': [
                'match',
                ['get', 'road_class'],
                ['primary', 'trunk', 'motorway'],
                '#555555',
                ['secondary', 'tertiary'],
                '#777777',
                '#999999',
              ],
              'line-width': [
                'match',
                ['get', 'road_class'],
                ['primary', 'trunk', 'motorway'],
                3,
                ['secondary', 'tertiary'],
                2,
                1,
              ],
              'line-opacity': 0.7,
            },
          },
          beforeId
        );
      } catch (err) {
        console.warn('[CampaignRoadsLayer]', err);
      }
    };

    const fetchAndApply = () => {
      const supabase = createClient();
      supabase
        .rpc('rpc_get_campaign_roads_v2', { p_campaign_id: campaignId })
        .then(({ data }) => {
          if (cancelled || !data) return;
          const fc = data as GeoJSON.FeatureCollection;
          if (!fc.features?.length) return;
          if (m.isStyleLoaded()) addRoadsLayer(fc);
          else m.once('style.load', () => addRoadsLayer(fc));
        })
        .catch(() => {});
    };

    const onStyleLoad = () => {
      fetchAndApply();
    };

    fetchAndApply();
    m.on('style.load', onStyleLoad);

    return () => {
      cancelled = true;
      m.off('style.load', onStyleLoad);
      removeRoads();
    };
  }, [campaignId, map, isMapReady, roadCacheVersion]);

  return null;
}
