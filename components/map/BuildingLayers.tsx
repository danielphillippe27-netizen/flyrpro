'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Map } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
import { createClient } from '@/lib/supabase/client';
import { isPmtilesGeometryProvider } from '@/lib/map/campaignMapManifest';

export type RenderingMode = '3d' | '2d';

type CampaignMapManifest = {
  artifact_type?: 'diamond' | 'white_gold' | 'basic';
  geometry_provider?: string | null;
  pmtiles_url?: string | null;
  geometry_url?: string | null;
  vector_tile_url_template?: string | null;
  static_vector_tile_url_template?: string | null;
  source_layers?: {
    buildings?: string | null;
  } | null;
  minzoom?: number | null;
  maxzoom?: number | null;
  bounds?: [number, number, number, number] | null;
};

function appendAccessToken(tileTemplate: string, accessToken?: string | null): string {
  if (!accessToken) return tileTemplate;
  const separator = tileTemplate.includes('?') ? '&' : '?';
  return `${tileTemplate}${separator}access_token=${encodeURIComponent(accessToken)}`;
}

async function fetchCampaignMapManifest(campaignId: string): Promise<{
  manifest: CampaignMapManifest | null;
  accessToken: string | null;
}> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;

  const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/diamond-manifest`, {
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    console.warn('[BuildingLayers] Campaign map manifest unavailable:', response.status);
    return { manifest: null, accessToken };
  }

  return {
    manifest: (await response.json()) as CampaignMapManifest,
    accessToken,
  };
}

interface BuildingLayersProps {
  map: Map;
  campaignId?: string | null;
  mode?: RenderingMode;
  onLayerReady?: (layerId: string | null) => void;
  onMarkerClick?: (addressId: string) => void;
  onBuildingClick?: (buildingId: string) => void;
}

export function BuildingLayers({ 
  map, 
  campaignId, 
  mode = '3d', 
  onLayerReady, 
  onMarkerClick, 
  onBuildingClick 
}: BuildingLayersProps) {
  const extrusionLayerRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const usingManifestSourceRef = useRef(false);
  const [activeBuildingIds, setActiveBuildingIds] = useState<Set<string>>(new Set());

  // Fetch active campaign GERS IDs (source_id) from Supabase
  // GERS-First Architecture: Query source_id instead of building_id
  const fetchActiveBuildingIds = useCallback(async () => {
    const supabase = createClient();
    
    try {
      // Get all active campaigns
      const { data: campaigns, error: campaignsError } = await supabase
        .from('campaigns')
        .select('id')
        .eq('status', 'active')
        .limit(100);

      if (campaignsError) {
        console.warn('[BuildingLayers] Error fetching active campaigns:', campaignsError);
        return new Set<string>();
      }

      if (!campaigns || campaigns.length === 0) {
        return new Set<string>();
      }

      const campaignIds = campaigns.map(c => c.id);

      // Get GERS IDs (source_id) from campaign_addresses
      // These will match the 'id' property in PMTiles features
      const { data: addresses, error: addressesError } = await supabase
        .from('campaign_addresses')
        .select('source_id')
        .in('campaign_id', campaignIds)
        .not('source_id', 'is', null)
        .limit(10000);

      if (addressesError) {
        console.warn('[BuildingLayers] Error fetching GERS IDs:', addressesError);
        return new Set<string>();
      }

      // Extract unique GERS IDs (source_id values)
      const gersIds = new Set<string>();
      addresses?.forEach(addr => {
        if (addr.source_id) {
          gersIds.add(String(addr.source_id));
        }
      });

      console.log(`[BuildingLayers] Found ${gersIds.size} active GERS IDs`);
      return gersIds;
    } catch (error) {
      console.error('[BuildingLayers] Error fetching active GERS IDs:', error);
      return new Set<string>();
    }
  }, []);

  // Note: Feature state is no longer used - we use match expression in paint properties instead
  // This function is kept for backward compatibility but does nothing
  const updateFeatureState = useCallback(() => {
    // GERS-First Architecture: Color matching is now done via match expression in paint properties
    // No need to update feature state
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!map) return;

    const loadPmtilesBuildings = async () => {
      try {
        if (!campaignId) {
          usingManifestSourceRef.current = false;
          // Cleanup when campaign is deselected
          if (extrusionLayerRef.current) {
            try {
              if (map.getLayer('flyr-campaign-buildings-line')) {
                map.removeLayer('flyr-campaign-buildings-line');
              }
              if (map.getLayer('flyr-campaign-buildings-extrusion')) {
                map.removeLayer('flyr-campaign-buildings-extrusion');
              }
              if (map.getSource('flyr-campaign-buildings-source')) {
                map.removeSource('flyr-campaign-buildings-source');
              }
            } catch (err) {
              console.warn('Error removing layers:', err);
            }
            extrusionLayerRef.current = null;
          }
          return;
        }

        console.log(`[BuildingLayers] Loading PMTiles buildings for campaign: ${campaignId}`);

        // Fetch active building IDs
        const activeIds = await fetchActiveBuildingIds();
        setActiveBuildingIds(activeIds);

        const sourceId = 'flyr-campaign-buildings-source';
        const layerId = 'flyr-campaign-buildings-extrusion';
        const lineLayerId = 'flyr-campaign-buildings-line';
        const { manifest, accessToken } = await fetchCampaignMapManifest(campaignId);
        const manifestBuildingLayer = manifest?.source_layers?.buildings ?? null;
        const manifestTileTemplate = manifest?.vector_tile_url_template ?? null;

        if (
          manifest &&
          isPmtilesGeometryProvider(manifest.geometry_provider) &&
          manifestBuildingLayer &&
          manifestTileTemplate
        ) {
          usingManifestSourceRef.current = true;

          if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(sourceId)) map.removeSource(sourceId);

          const vectorSource: mapboxgl.VectorSourceSpecification & { buffer?: number } = {
            type: 'vector',
            minzoom: manifest.minzoom ?? 13,
            maxzoom: manifest.maxzoom ?? 18,
            buffer: 128,
            ...(manifest.bounds ? { bounds: manifest.bounds } : {}),
          };
          vectorSource.tiles = [appendAccessToken(manifestTileTemplate, accessToken)];

          map.addSource(sourceId, vectorSource);

          if (mode === '2d') {
            map.addLayer({
              id: layerId,
              type: 'fill',
              source: sourceId,
              'source-layer': manifestBuildingLayer,
              minzoom: manifest.minzoom ?? 13,
              paint: {
                'fill-color': [
                  'case',
                  ['has', 'address_id'],
                  '#ef4444',
                  '#9ca3af',
                ],
                'fill-opacity': 0.72,
                'fill-outline-color': 'rgba(0, 0, 0, 0)',
              },
            });

            map.addLayer({
              id: lineLayerId,
              type: 'line',
              source: sourceId,
              'source-layer': manifestBuildingLayer,
              minzoom: manifest.minzoom ?? 13,
              paint: {
                'line-color': '#111827',
                'line-opacity': 0,
                'line-width': 1,
              },
            });
          } else {
            map.addLayer({
              id: layerId,
              type: 'fill-extrusion',
              source: sourceId,
              'source-layer': manifestBuildingLayer,
              minzoom: manifest.minzoom ?? 13,
              filter: ['==', '$type', 'Polygon'],
              layout: {
                'fill-extrusion-edge-radius': 0.6,
              },
              paint: {
                'fill-extrusion-color': [
                  'case',
                  ['has', 'address_id'],
                  '#ef4444',
                  '#9ca3af',
                ],
                'fill-extrusion-opacity': 0.85,
                'fill-extrusion-height': [
                  'case',
                  ['has', 'height'],
                  ['get', 'height'],
                  ['has', 'render_height'],
                  ['get', 'render_height'],
                  8,
                ],
                'fill-extrusion-base': [
                  'case',
                  ['has', 'min_height'],
                  ['get', 'min_height'],
                  0,
                ],
                'fill-extrusion-vertical-gradient': true,
                'fill-extrusion-rounded-roof': true,
              },
            });
          }

          console.log(
            `[BuildingLayers] Added ${manifest.artifact_type ?? 'campaign'} manifest layer: ${manifestBuildingLayer}`
          );

          const manifestClickHandler = (e: mapboxgl.MapLayerMouseEvent) => {
            const feature = e.features?.[0];
            const props = feature?.properties || {};
            const addressId = props.address_id ? String(props.address_id) : null;
            const buildingId = props.building_id || props.id || props.gers_id;

            if (addressId && onMarkerClick) onMarkerClick(addressId);
            if (buildingId && onBuildingClick) onBuildingClick(String(buildingId));
          };

          map.on('click', layerId, manifestClickHandler);
          map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
          });

          extrusionLayerRef.current = layerId;
          onLayerReady?.(layerId);
          return;
        }

        usingManifestSourceRef.current = false;
        console.warn('[BuildingLayers] No backend ZXY building manifest source available.');
        return;
      } catch (error) {
        console.error('[BuildingLayers] Error loading PMTiles buildings:', error);
      }
    };

    loadPmtilesBuildings();

    return () => {
      isMountedRef.current = false;
    };
  }, [map, campaignId, mode, onLayerReady, onMarkerClick, onBuildingClick, fetchActiveBuildingIds, updateFeatureState]);

  // Subscribe to campaign changes for real-time updates
  useEffect(() => {
    if (!map || !campaignId) return;

    const supabase = createClient();
    const channel = supabase
      .channel('campaign-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campaigns',
        },
        async () => {
          // Refresh active GERS IDs when campaigns change
          const activeIds = await fetchActiveBuildingIds();
          setActiveBuildingIds(activeIds);
          // Update layer paint property with new GERS IDs
          if (!usingManifestSourceRef.current && map.getLayer('flyr-campaign-buildings-extrusion')) {
            map.setPaintProperty('flyr-campaign-buildings-extrusion', 'fill-extrusion-color', [
              'match',
              ['get', 'id'],
              Array.from(activeIds),
              '#10b981',
              '#9ca3af'
            ]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [map, campaignId, fetchActiveBuildingIds, updateFeatureState]);

  // Update layer paint property when active GERS IDs change
  useEffect(() => {
    if (!map || activeBuildingIds.size === 0 || usingManifestSourceRef.current) return;
    
    // Update the match expression with new GERS IDs
    if (map.getLayer('flyr-campaign-buildings-extrusion')) {
      map.setPaintProperty('flyr-campaign-buildings-extrusion', 'fill-extrusion-color', [
        'match',
        ['get', 'id'],
        Array.from(activeBuildingIds),
        '#10b981',
        '#9ca3af'
      ]);
    }
  }, [map, activeBuildingIds]);

  return null;
}
