'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Map } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
// @ts-ignore - pmtiles types may not be available yet
import { installProtocol } from 'pmtiles';
import { createClient } from '@/lib/supabase/client';

export type RenderingMode = '3d' | '2d';

// Get PMTiles URL from environment or construct from Supabase URL
function getPmtilesUrl(): string {
  // Check for explicit PMTILES_URL environment variable
  const explicitUrl = process.env.NEXT_PUBLIC_PMTILES_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  // Construct from Supabase URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
  const cleanUrl = supabaseUrl.trim().replace(/\/$/, '');
  return `${cleanUrl}/storage/v1/object/public/map-tiles/buildings.pmtiles`;
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
  const protocolInstalledRef = useRef(false);
  const [activeBuildingIds, setActiveBuildingIds] = useState<Set<string>>(new Set());

  // Install PMTiles protocol once when map loads
  useEffect(() => {
    if (!map || protocolInstalledRef.current) return;

    try {
      installProtocol(map);
      protocolInstalledRef.current = true;
      console.log('[BuildingLayers] PMTiles protocol installed');
    } catch (error) {
      console.error('[BuildingLayers] Failed to install PMTiles protocol:', error);
    }
  }, [map]);

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

      // Extract unique GERS IDs (gers_id values)
      const gersIds = new Set<string>();
      addresses?.forEach(addr => {
        if (addr.gers_id) {
          gersIds.add(String(addr.gers_id));
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
  const updateFeatureState = useCallback((map: Map, activeIds: Set<string>) => {
    // GERS-First Architecture: Color matching is now done via match expression in paint properties
    // No need to update feature state
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!map) return;

    const loadPmtilesBuildings = async () => {
      try {
        if (!campaignId) {
          // Cleanup when campaign is deselected
          if (extrusionLayerRef.current) {
            try {
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
        const pmtilesUrl = getPmtilesUrl();

        // Convert Set to Array for match expression
        const activeGersIdsArray = Array.from(activeIds);

        // Add or update vector source
        if (map.getSource(sourceId)) {
          // Source already exists, update layer paint properties with new GERS IDs
          if (map.getLayer(layerId)) {
            // Update the match expression with new GERS IDs
            map.setPaintProperty(layerId, 'fill-extrusion-color', [
              'match',
              ['get', 'id'], // Match against 'id' property (GERS ID from PMTiles)
              activeGersIdsArray,
              '#10b981', // Green for active campaigns
              '#9ca3af'  // Gray for inactive
            ]);
          }
        } else {
          // Add PMTiles vector source
          map.addSource(sourceId, {
            type: 'vector',
            url: `pmtiles://${pmtilesUrl}`,
          });

          console.log(`[BuildingLayers] Added PMTiles source: ${pmtilesUrl}`);

          // Wait for source to load
          map.once('sourcedata', () => {
            if (!isMountedRef.current) return;

            // Add fill-extrusion layer
            if (!map.getLayer(layerId)) {
              map.addLayer({
                id: layerId,
                type: 'fill-extrusion',
                source: sourceId,
                'source-layer': 'buildings', // PMTiles layer name (matches -L buildings: flag in tippecanoe)
                minzoom: 10,
                filter: ['==', '$type', 'Polygon'],
                paint: {
                  // GERS-First Architecture: Use match expression to color by GERS ID
                  // Match 'id' property (GERS ID) against list of active source_ids
                  'fill-extrusion-color': [
                    'match',
                    ['get', 'id'], // Get 'id' property from PMTiles feature (this is the GERS ID)
                    activeGersIdsArray, // List of active GERS IDs from campaign_addresses.gers_id
                    '#10b981', // Green for active campaigns
                    '#9ca3af'  // Gray for inactive
                  ],
                  'fill-extrusion-opacity': 0.85,
                  'fill-extrusion-height': [
                    'case',
                    ['has', 'height'],
                    ['get', 'height'],
                    ['get', 'render_height'],
                    10, // Default
                  ],
                  'fill-extrusion-base': [
                    'case',
                    ['has', 'min_height'],
                    ['get', 'min_height'],
                    0,
                  ],
                  'fill-extrusion-vertical-gradient': true,
                },
              });

              console.log('[BuildingLayers] Added fill-extrusion layer with GERS ID matching');
            }
          });
        }

        // Add click handler with popup
        // GERS-First Architecture: Extract GERS ID from PMTiles feature properties
        const clickHandler = async (e: mapboxgl.MapLayerMouseEvent) => {
          if (!e.features || e.features.length === 0) return;

          const feature = e.features[0];
          const props = feature.properties || {};

          // Extract GERS ID from PMTiles feature properties
          // The 'id' property should contain the GERS ID (baked into PMTiles by bake.sql)
          const gersId = props.id || props.gers_id;
          
          if (!gersId) {
            console.warn('[BuildingLayers] No GERS ID found in feature properties:', props);
            // Fallback: show popup with basic info
            const fullAddress = props.full_address || 'Address not available';
            const renderHeight = props.height || props.render_height || 10;
            const popup = new mapboxgl.Popup({ closeOnClick: true })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="padding: 8px;">
                  <div style="font-weight: 600; margin-bottom: 4px;">${fullAddress}</div>
                  <div style="font-size: 0.875rem; color: #6b7280;">
                    Height: <span style="color: #111827;">${Math.round(renderHeight)}m</span>
                  </div>
                  <div style="font-size: 0.75rem; color: #ef4444; margin-top: 4px;">
                    ⚠️ No GERS ID found
                  </div>
                </div>
              `)
              .addTo(map);
            return;
          }

          // Fetch building details from API using GERS ID
          try {
            const response = await fetch(`/api/buildings/${gersId}${campaignId ? `?campaign_id=${campaignId}` : ''}`);
            
            if (!response.ok) {
              throw new Error(`API returned ${response.status}`);
            }

            const buildingData = await response.json();

            // Create popup with building details
            const popup = new mapboxgl.Popup({ closeOnClick: true })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="padding: 8px;">
                  <div style="font-weight: 600; margin-bottom: 4px;">${buildingData.address || props.full_address || 'Address not available'}</div>
                  <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 2px;">
                    Campaign: <span style="color: #111827;">${buildingData.campaign_name || 'Unknown'}</span>
                  </div>
                  <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 2px;">
                    Status: <span style="color: ${buildingData.status === 'visited' ? '#10b981' : '#6b7280'};">${buildingData.status || 'not_visited'}</span>
                  </div>
                  ${buildingData.scans > 0 ? `
                    <div style="font-size: 0.875rem; color: #6b7280;">
                      Scans: <span style="color: #111827;">${buildingData.scans}</span>
                    </div>
                  ` : ''}
                  <div style="font-size: 0.75rem; color: #9ca3af; margin-top: 4px; font-family: monospace;">
                    GERS ID: ${gersId.substring(0, 20)}...
                  </div>
                </div>
              `)
              .addTo(map);

            // Trigger callbacks
            if (onBuildingClick) {
              onBuildingClick(gersId);
            }
            if (buildingData.address_id && onMarkerClick) {
              onMarkerClick(buildingData.address_id);
            }
          } catch (error) {
            console.error('[BuildingLayers] Error fetching building details:', error);
            // Fallback popup on error
            const fullAddress = props.full_address || 'Address not available';
            const renderHeight = props.height || props.render_height || 10;
            const popup = new mapboxgl.Popup({ closeOnClick: true })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="padding: 8px;">
                  <div style="font-weight: 600; margin-bottom: 4px;">${fullAddress}</div>
                  <div style="font-size: 0.875rem; color: #6b7280;">
                    Height: <span style="color: #111827;">${Math.round(renderHeight)}m</span>
                  </div>
                  <div style="font-size: 0.75rem; color: #ef4444; margin-top: 4px;">
                    ⚠️ Error loading details
                  </div>
                </div>
              `)
              .addTo(map);
          }
        };

        // Remove existing handlers and add new one
        map.off('click', layerId, clickHandler as any);
        map.on('click', layerId, clickHandler);

        // Change cursor on hover
        map.on('mouseenter', layerId, () => {
          if (map.getCanvas()) {
            map.getCanvas().style.cursor = 'pointer';
          }
        });

        map.on('mouseleave', layerId, () => {
          if (map.getCanvas()) {
            map.getCanvas().style.cursor = '';
          }
        });

        extrusionLayerRef.current = layerId;
        onLayerReady?.(layerId);
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
          if (map.getLayer('flyr-campaign-buildings-extrusion')) {
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
    if (!map || activeBuildingIds.size === 0) return;
    
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
