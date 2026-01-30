'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Map } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
import { createClient } from '@/lib/supabase/client';
import type { BuildingFeatureCollection, BuildingProperties, GetBuildingsInBboxParams } from '@/types/map-buildings';
import type { ViewMode } from './ViewModeToggle';

interface MapBuildingsLayerProps {
  map: Map;
  campaignId?: string | null;
  viewMode?: ViewMode;
  showOrphans?: boolean; // Toggle to show/hide orphan buildings (buildings without address links)
  onBuildingClick?: (buildingId: string) => void;
  onAddToCRM?: (data: { address: string; addressId?: string; gersId?: string; campaignId?: string }) => void;
}

export function MapBuildingsLayer({ map, campaignId, viewMode = 'standard', showOrphans = true, onBuildingClick, onAddToCRM }: MapBuildingsLayerProps) {
  const [features, setFeatures] = useState<BuildingFeatureCollection | null>(null);
  const [zoomLevel, setZoomLevel] = useState(15);
  const sourceId = 'map-buildings-source';
  const layerId = 'map-buildings-extrusion';
  const shadowLayerId = 'map-buildings-shadow';
  const supabase = createClient();
  
  // Debounce fetching to prevent spamming Supabase during rapid panning
  const fetchTimeout = useRef<NodeJS.Timeout>();
  const isMountedRef = useRef(true);

  // Generate filter expression based on showOrphans toggle
  // When showOrphans=false in campaign mode, only show buildings with feature_status='matched'
  // NOTE: fill-extrusion layers don't need geometry type filter - they only render polygon-like geometries
  const getFilterExpression = (showAll: boolean, isCampaignMode: boolean): any[] | undefined => {
    if (!isCampaignMode || showAll) {
      // Show all features - no filter needed for fill-extrusion (it only renders polygons anyway)
      return undefined;
    }
    // Campaign mode with showOrphans=false: only show matched buildings
    return ['==', ['get', 'feature_status'], 'matched'];
  };

  // Generate color expression based on view mode and stable linker (feature_status)
  // When campaignId is set and not QR view: use feature_status (matched=red, orphan_building=grey)
  // Uses ['feature-state', 'status'] for real-time updates via setFeatureState(),
  // with fallback to ['get', 'status'] for initial data from properties
  const getColorExpression = (mode: ViewMode, useStableLinkerColors?: boolean): any => {
    if (useStableLinkerColors) {
      // Stable linker: matched (red), orphan_building (grey)
      return [
        'case',
        ['==', ['coalesce', ['get', 'feature_status'], ''], 'matched'],
        '#ef4444', // Red for matched (has link)
        '#6b7280'  // Grey for orphan_building (no link)
      ] as any;
    }
    if (mode === 'qr') {
      // QR View: Black for not_scanned, Gold for scanned
      // Priority: feature-state (real-time) > properties (initial load) > default
      return [
        'case',
        ['==', 
          ['coalesce', 
            ['feature-state', 'status'],  // Real-time state (priority)
            ['get', 'status'],             // Initial property fallback
            'not_visited'
          ], 
          'visited'
        ],
        '#facc15', // Gold for scanned
        ['==', 
          ['coalesce', 
            ['feature-state', 'status'],
            ['get', 'status'],
            'not_visited'
          ], 
          'hot'
        ],
        '#fbbf24', // Brighter gold for hot
        '#1a1a1a'  // Black for not_scanned
      ] as any;
    } else {
      // Standard/Work View: Red for not_visited, Green for visited
      // Priority: feature-state (real-time) > properties (initial load) > default
      return [
        'case',
        ['==', 
          ['coalesce', 
            ['feature-state', 'status'],  // Real-time state (priority)
            ['get', 'status'],             // Initial property fallback
            'not_visited'
          ], 
          'visited'
        ],
        '#22c55e', // Green for visited/scanned
        ['==', 
          ['coalesce', 
            ['feature-state', 'status'],
            ['get', 'status'],
            'not_visited'
          ], 
          'hot'
        ],
        '#f59e0b', // Orange for hot
        '#ef4444'  // Red for not_visited (default)
      ] as any;
    }
  };

  // Track if campaign data has been loaded (for "fetch once, render forever" pattern)
  const campaignDataLoadedRef = useRef<string | null>(null);

  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:15',message:'Component mounted',data:{hasMap:!!map,hasCampaignId:!!campaignId,campaignId,mapLoaded:map?.loaded?.()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  }, [map, campaignId]);
  // #endregion

  // CAMPAIGN MODE: Fetch ALL campaign features once (no viewport filtering)
  // This enables "fetch once, render forever" for buttery smooth pan/zoom
  const fetchCampaignData = useCallback(async () => {
    if (!isMountedRef.current || !campaignId) return;

    console.log('[MapBuildingsLayer] Campaign Mode: Fetching full campaign data', { campaignId });

    try {
      const { data, error } = await supabase.rpc('rpc_get_campaign_full_features', {
        p_campaign_id: campaignId
      });

      if (error) {
        console.error('[MapBuildingsLayer] Error fetching campaign data:', error);
        return;
      }

      if (data && isMountedRef.current) {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        console.log('[MapBuildingsLayer] Campaign data loaded (full):', {
          featuresCount: parsedData?.features?.length,
          campaignId,
          mode: 'campaign-persistence',
        });
        
        campaignDataLoadedRef.current = campaignId;
        setFeatures(parsedData as BuildingFeatureCollection);
      }
    } catch (err) {
      console.error('[MapBuildingsLayer] Error in fetchCampaignData:', err);
    }
  }, [supabase, campaignId]);

  // EXPLORATION MODE: Fetch buildings in viewport bounding box (when no campaignId)
  const fetchBuildingsInViewport = useCallback(async (bounds: { ne: [number, number]; sw: [number, number] }) => {
    if (!isMountedRef.current) return;

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:27',message:'fetchBuildingsInViewport called',data:{bounds,isMounted:isMountedRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion

    try {
      const rpcParams = {
        min_lon: bounds.sw[0],
        min_lat: bounds.sw[1],
        max_lon: bounds.ne[0],
        max_lat: bounds.ne[1],
      };

      const { data, error } = await supabase.rpc('rpc_get_buildings_in_bbox', rpcParams as GetBuildingsInBboxParams);

      if (error) {
        console.error('[MapBuildingsLayer] Error fetching buildings:', error);
        return;
      }

      if (data && isMountedRef.current) {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        console.log('[MapBuildingsLayer] Exploration mode - fetched buildings:', {
          featuresCount: parsedData?.features?.length,
          bounds,
          mode: 'viewport-based',
        });
        
        setFeatures(parsedData as BuildingFeatureCollection);
      }
    } catch (err) {
      console.error('[MapBuildingsLayer] Error fetching buildings:', err);
    }
  }, [supabase]);

  // Handle zoom changes (for layer visibility control)
  // In campaign mode: just track zoom for layer visibility (data already loaded)
  // In exploration mode: track zoom AND trigger viewport fetch
  const onZoomChanged = useCallback(() => {
    if (!map || !isMountedRef.current) return;

    const zoom = map.getZoom();
    setZoomLevel(zoom);

    // Remove layers if zoomed out too far
    if (zoom < 12) {
      if (map.getLayer(layerId)) {
        try {
          map.removeLayer(layerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(shadowLayerId)) {
        try {
          map.removeLayer(shadowLayerId);
        } catch (err) {
          // Layer might not exist
        }
      }
    }
  }, [map]);

  // EXPLORATION MODE ONLY: Handle viewport changes (pan/zoom)
  // Campaign mode doesn't use this - data is already fully loaded
  const onViewportChanged = useCallback(() => {
    if (!map || !isMountedRef.current || campaignId) return; // Skip if campaign mode

    const zoom = map.getZoom();
    setZoomLevel(zoom);

    // Only fetch if zoomed in enough (zoom >= 12 for better visibility)
    if (zoom < 12) {
      // Remove layers if zoomed out too far
      if (map.getLayer(layerId)) {
        try {
          map.removeLayer(layerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(shadowLayerId)) {
        try {
          map.removeLayer(shadowLayerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      return;
    }

    // Debounce fetching to prevent spamming during rapid panning
    if (fetchTimeout.current) {
      clearTimeout(fetchTimeout.current);
    }

    fetchTimeout.current = setTimeout(async () => {
      if (!map || !isMountedRef.current || campaignId) return;

      try {
        const bounds = map.getBounds();
        if (bounds) {
          const ne = bounds.getNorthEast();
          const sw = bounds.getSouthWest();
          await fetchBuildingsInViewport({
            ne: [ne.lng, ne.lat],
            sw: [sw.lng, sw.lat],
          });
        }
      } catch (err) {
        console.error('[MapBuildingsLayer] Error getting map bounds:', err);
      }
    }, 200); // 200ms debounce
  }, [map, campaignId, fetchBuildingsInViewport]);

  // CAMPAIGN MODE: Fetch full campaign data once when campaignId is set
  // This is the "fetch once, render forever" pattern for smooth pan/zoom
  useEffect(() => {
    if (!map || !campaignId) return;
    
    // Only fetch if we haven't already loaded this campaign's data
    if (campaignDataLoadedRef.current === campaignId) {
      console.log('[MapBuildingsLayer] Campaign data already loaded, skipping fetch');
      return;
    }

    const doFetch = () => {
      if (map.loaded()) {
        // Update zoom level for layer visibility
        setZoomLevel(map.getZoom());
        fetchCampaignData();
      } else {
        map.once('load', () => {
          setZoomLevel(map.getZoom());
          fetchCampaignData();
        });
      }
    };
    doFetch();

    // Listen only to zoom changes for layer visibility (not for data fetching)
    map.on('zoomend', onZoomChanged);

    return () => {
      map.off('zoomend', onZoomChanged);
    };
  }, [map, campaignId, fetchCampaignData, onZoomChanged]);

  // EXPLORATION MODE: Set up viewport event listeners (only when no campaignId)
  useEffect(() => {
    if (!map || campaignId) return; // Skip in campaign mode

    // Listen to camera changes (move, zoom, pitch, rotate) for viewport-based fetching
    map.on('moveend', onViewportChanged);
    map.on('zoomend', onViewportChanged);
    map.on('pitchend', onViewportChanged);
    map.on('rotateend', onViewportChanged);

    // Initial fetch - wait for map to be loaded
    const doInitialFetch = () => {
      if (map.loaded()) {
        onViewportChanged();
      } else {
        map.once('load', onViewportChanged);
      }
    };
    doInitialFetch();

    return () => {
      if (fetchTimeout.current) {
        clearTimeout(fetchTimeout.current);
      }
      map.off('moveend', onViewportChanged);
      map.off('zoomend', onViewportChanged);
      map.off('pitchend', onViewportChanged);
      map.off('rotateend', onViewportChanged);
      map.off('load', onViewportChanged);
    };
  }, [map, campaignId, onViewportChanged]);

  // Update Mapbox source and layer when features change
  useEffect(() => {
    // Log every time this effect runs to debug reactivity
    console.log('[MapBuildingsLayer] Layer update effect triggered:', {
      hasMap: !!map,
      hasFeatures: !!features,
      featuresCount: features?.features?.length,
      zoomLevel,
    });

    // Only bail if map doesn't exist
    if (!map) {
      console.log('[MapBuildingsLayer] Skipping layer update: no map');
      return;
    }

    // Define the update logic as a function we can call or defer
    const updateLayers = () => {
      console.log('[MapBuildingsLayer] updateLayers called:', {
        hasFeatures: !!features,
        featuresCount: features?.features?.length,
        isStyleLoaded: map.isStyleLoaded(),
        mapLoaded: map.loaded(),
      });

      // Check if style is loaded - we need this to add layers
      if (!map.isStyleLoaded()) {
        console.log('[MapBuildingsLayer] Style not loaded in updateLayers, will retry on idle');
        return;
      }

      const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;

      // If source already exists and we have features, update the data immediately
      // This handles the race condition where features arrive after source was created
      if (source && features) {
        console.log('[MapBuildingsLayer] Updating existing source with', features.features.length, 'features');
        source.setData(features);
      }

      // Check if we should proceed with layer creation/updates
      if (!features || features.features.length === 0 || zoomLevel < 12) {
        console.log('[MapBuildingsLayer] Skipping layer creation:', { hasFeatures: !!features, featuresCount: features?.features?.length, zoomLevel });
        return;
      }

      // Create source if it doesn't exist yet (source update already handled above)
      if (!source) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:219',message:'Creating new source',data:{featuresCount:features.features.length,featureTypes:features.features.map(f=>f.geometry?.type),firstFeatureGeometry:features.features[0]?.geometry?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        try {
          map.addSource(sourceId, {
            type: 'geojson',
            data: features,
            // promoteId enables setFeatureState() for real-time color updates
            // Features are identified by their gers_id property
            promoteId: 'gers_id',
            // Buffer extends tile loading 512px beyond viewport edge
            // This prevents edge-clipping when panning in campaign mode
            buffer: 512,
            // Tolerance for geometry simplification (smaller = more detail)
            tolerance: 0.5,
          });
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:226',message:'Source created',data:{sourceExists:!!map.getSource(sourceId),sourceType:map.getSource(sourceId)?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
        } catch (err) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:228',message:'Error adding source',data:{error:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          console.error('Error adding source:', err);
          return;
        }
      }

      // Add or update fill-extrusion layer
    if (!map.getLayer(layerId)) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:140',message:'Adding fill-extrusion layer',data:{layerId,sourceId,featuresCount:features.features.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      try {
        // NOTE: Shadow layer removed to fix "dark square" visual artifact
        // The 3D fill-extrusion with proper lighting provides sufficient visual depth
        const filterExpr = getFilterExpression(showOrphans, !!campaignId);

        // Add the main building layer
        // Add without beforeId to place at end (on top of everything, including labels)
        const layerConfig: any = {
          id: layerId,
          type: 'fill-extrusion' as const,
          source: sourceId,
          minzoom: 12,
          paint: {
            'fill-extrusion-color': getColorExpression(viewMode, !!campaignId && viewMode !== 'qr'),
            'fill-extrusion-vertical-gradient': true,
            'fill-extrusion-height': ['coalesce', ['get', 'height'], ['get', 'height_m'], 10] as any,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 1.0,
          },
        };
        
        // Only add filter if defined (undefined means show all)
        if (filterExpr) {
          layerConfig.filter = filterExpr;
        }
        
        // Add without beforeId - this places it at the end (on top of everything)
        map.addLayer(layerConfig);

        // Set map lighting for 3D depth visualization
        // Use 'map' anchor instead of 'viewport' to avoid lighting warnings and ensure consistent 3D depth
        try {
          map.setLight({
            anchor: 'map',
            color: 'white',
            intensity: 0.6, // Increased intensity for better visibility on dark backgrounds
            position: [1.15, 210, 30]
          });
        } catch (lightErr) {
          console.warn('[MapBuildingsLayer] Error setting map lighting:', lightErr);
        }
        
        // Verify the layer was actually added and check all properties
        const addedLayer = map.getLayer(layerId);
        const currentZoom = map.getZoom();
        const layerMinzoom = addedLayer ? (addedLayer as any).minzoom : null;
        const layerVisibility = addedLayer ? map.getLayoutProperty(layerId, 'visibility') : null;
        const paintOpacity = addedLayer ? map.getPaintProperty(layerId, 'fill-extrusion-opacity') : null;
        const paintColor = addedLayer ? map.getPaintProperty(layerId, 'fill-extrusion-color') : null;
        const paintHeight = addedLayer ? map.getPaintProperty(layerId, 'fill-extrusion-height') : null;
        const paintGradient = addedLayer ? map.getPaintProperty(layerId, 'fill-extrusion-vertical-gradient') : null;
        
        // Check source data
        const sourceAfter = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
        const sourceData = sourceAfter ? (sourceAfter as any)._data : null;
        const sourceFeatureCount = sourceData?.features?.length || 0;
        
        // Check layer order - find what's above and below
        const allLayers = map.getStyle().layers;
        const layerIndex = allLayers.findIndex(l => l.id === layerId);
        const layerAbove = layerIndex > 0 ? allLayers[layerIndex - 1] : null;
        const layerBelow = layerIndex < allLayers.length - 1 ? allLayers[layerIndex + 1] : null;
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:290',message:'Layer verification',data:{layerExists:!!addedLayer,layerId,currentZoom,layerMinzoom,zoomMeetsMinzoom:currentZoom >= (layerMinzoom || 0),layerVisibility,paintOpacity,paintColor,paintHeight,paintGradient,sourceFeatureCount,sourceHasData:!!sourceData,layerIndex,layerAbove:layerAbove?.id,layerAboveType:layerAbove?.type,layerBelow:layerBelow?.id,layerBelowType:layerBelow?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        
        console.log('[MapBuildingsLayer] Building layer added successfully', {
          layerId,
          featuresCount: features.features.length,
          zoomLevel,
          layerExists: !!addedLayer,
          opacity: paintOpacity,
          currentZoom,
          viewMode,
          colorExpression: getColorExpression(viewMode, !!campaignId && viewMode !== 'qr'),
          sampleFeatureStatus: features.features[0]?.properties?.status,
        });
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:163',message:'Layer added successfully',data:{layerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion

        // Helpers used in click handler (must be defined before popup content)
        const escapeHtml = (text: string): string => {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        };
        const getStatusColor = (status: string): string => {
          switch (status.toLowerCase()) {
            case 'hot': return '#ef4444';
            case 'warm': return '#f59e0b';
            case 'cold': return '#6b7280';
            case 'new':
            default: return '#3b82f6';
          }
        };

        // Add click handler to fetch and display resident data
        const clickHandler = async (e: mapboxgl.MapLayerMouseEvent) => {
          if (!e.features || e.features.length === 0) return;
          
          const feature = e.features[0];
          const props = feature.properties as BuildingProperties;
          const gersId = props.gers_id;
          
          // If no gers_id, fall back to onBuildingClick with id
          // Note: HouseDetailPanel expects gers_id, but will handle id as fallback
          if (!gersId) {
            if (props.id && onBuildingClick) {
              onBuildingClick(props.id);
            }
            return;
          }

          // Fetch contacts by GERS ID
          try {
            const { data: contacts, error } = await supabase
              .from('contacts')
              .select('full_name, phone, email, status, notes')
              .eq('gers_id', gersId)
              .eq('campaign_id', campaignId || '');

            if (error) {
              console.error('[MapBuildingsLayer] Error fetching contacts:', error);
            }

            // Address: prefer stable linker address_text from feature props, else fetch
            let addressInfo: { address?: string; addressId?: string } = {};
            if (props.address_text) {
              addressInfo.address = props.address_text;
            }
            if ((!contacts || contacts.length === 0) && onAddToCRM && !addressInfo.address) {
              const { data: addressData } = await supabase
                .from('campaign_addresses')
                .select('id, address, formatted, gers_id')
                .or(`gers_id.eq.${gersId},gers_id_uuid.eq.${gersId}`)
                .eq('campaign_id', campaignId || '')
                .maybeSingle();

              if (addressData) {
                addressInfo = {
                  address: addressData.formatted || addressData.address,
                  addressId: addressData.id,
                };
              }
            }

            // Create popup content
            let popupContent = '';
            let buttonId: string | null = null;
            const popupData = {
              address: addressInfo.address || '',
              addressId: addressInfo.addressId,
              gersId: gersId,
              campaignId: campaignId || undefined,
            };
            
            if (contacts && contacts.length > 0) {
              popupContent = '<div style="padding: 12px; max-width: 300px;">';
              if (props.match_method) {
                popupContent += '<div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 8px;">Linked via: ' + escapeHtml(props.match_method) + '</div>';
              }
              popupContent += '<div style="font-weight: 600; margin-bottom: 8px; font-size: 16px;">Resident Information</div>';
              
              contacts.forEach((contact, index) => {
                if (index > 0) {
                  popupContent += '<hr style="margin: 12px 0; border: none; border-top: 1px solid #e5e7eb;" />';
                }
                popupContent += `<div style="margin-bottom: 8px;">`;
                if (contact.full_name) {
                  popupContent += `<div style="font-weight: 500; margin-bottom: 4px;">${escapeHtml(contact.full_name)}</div>`;
                }
                if (contact.phone) {
                  popupContent += `<div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 2px;">📞 ${escapeHtml(contact.phone)}</div>`;
                }
                if (contact.email) {
                  popupContent += `<div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 2px;">✉️ ${escapeHtml(contact.email)}</div>`;
                }
                if (contact.status) {
                  const statusColor = getStatusColor(contact.status);
                  popupContent += `<div style="font-size: 0.75rem; margin-top: 4px;"><span style="background: ${statusColor}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: 500;">${escapeHtml(contact.status)}</span></div>`;
                }
                if (contact.notes) {
                  popupContent += `<div style="font-size: 0.875rem; color: #374151; margin-top: 6px; font-style: italic;">${escapeHtml(contact.notes)}</div>`;
                }
                popupContent += `</div>`;
              });
              
              popupContent += '</div>';
            } else {
              // No contacts found - show "Add to CRM" button
              const addressDisplay = addressInfo.address ? escapeHtml(addressInfo.address) : 'this address';
              popupContent = '<div style="padding: 12px; max-width: 280px;">';
              if (props.match_method) {
                popupContent += '<div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 6px;">Linked via: ' + escapeHtml(props.match_method) + '</div>';
              }
              popupContent += '<div style="font-weight: 600; margin-bottom: 6px; font-size: 16px;">No Resident Data</div>';
              popupContent += `<div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 12px;">No resident data available for ${addressDisplay}.</div>`;
              
              if (onAddToCRM) {
                // Generate unique ID for this button
                buttonId = `add-to-crm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                popupContent += `<button id="${buttonId}" style="width: 100%; background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 500; font-size: 0.875rem; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">Add to CRM</button>`;
              }
              
              popupContent += '</div>';
            }

            // Always trigger onBuildingClick if available - this opens the LocationCard
            // The LocationCard provides a richer UI than the popup
            if (onBuildingClick) {
              onBuildingClick(gersId);
              // Skip showing the basic popup since LocationCard will handle the UI
              return;
            }

            // Fallback: show popup if onBuildingClick is not provided
            const popup = new mapboxgl.Popup({ closeOnClick: true })
              .setLngLat(e.lngLat)
              .setHTML(popupContent)
              .addTo(map);

            // If "Add to CRM" button exists, attach click handler
            if (buttonId && onAddToCRM) {
              // Use setTimeout to ensure DOM is ready
              setTimeout(() => {
                const button = document.getElementById(buttonId!);
                if (button) {
                  button.addEventListener('click', (evt) => {
                    evt.stopPropagation();
                    evt.preventDefault();
                    popup.remove();
                    onAddToCRM(popupData);
                  });
                }
              }, 100);
            }
          } catch (err) {
            console.error('[MapBuildingsLayer] Error in click handler:', err);
            // Fallback to onBuildingClick - prefer gers_id (what HouseDetailPanel expects)
            if (gersId && onBuildingClick) {
              onBuildingClick(gersId);
            } else if (props.id && onBuildingClick) {
              onBuildingClick(props.id);
            }
          }
        };

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
      } catch (err) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:163',message:'Error adding layer',data:{error:String(err),layerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        console.error('Error adding fill-extrusion layer:', err);
      }
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:189',message:'Layer already exists',data:{layerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
        // Update paint properties for existing layer to ensure opacity is correct
        try {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:479',message:'Updating existing layer',data:{layerId,layerExists:!!map.getLayer(layerId),currentOpacity:map.getPaintProperty(layerId,'fill-extrusion-opacity'),currentColor:map.getPaintProperty(layerId,'fill-extrusion-color')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        const colorExpr = getColorExpression(viewMode, !!campaignId && viewMode !== 'qr');
        console.log('[MapBuildingsLayer] Updating existing layer colors', {
          viewMode,
          colorExpression: colorExpr,
          layerId,
        });
        map.setPaintProperty(layerId, 'fill-extrusion-opacity', 1.0);
        map.setPaintProperty(layerId, 'fill-extrusion-color', colorExpr);
        map.setPaintProperty(layerId, 'fill-extrusion-vertical-gradient', true);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:483',message:'Paint properties updated',data:{opacity:map.getPaintProperty(layerId,'fill-extrusion-opacity'),color:map.getPaintProperty(layerId,'fill-extrusion-color'),gradient:map.getPaintProperty(layerId,'fill-extrusion-vertical-gradient')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        
        // Move layer to the end (on top of everything)
        try {
          // Remove and re-add to move to end, or use moveLayer with undefined to move to end
          // Actually, we can't move to end directly, so we'll remove and re-add
          const layerConfig = map.getLayer(layerId);
          if (layerConfig) {
            // Get current paint properties
            const currentPaint = {
              opacity: map.getPaintProperty(layerId, 'fill-extrusion-opacity'),
              color: map.getPaintProperty(layerId, 'fill-extrusion-color'),
              height: map.getPaintProperty(layerId, 'fill-extrusion-height'),
              base: map.getPaintProperty(layerId, 'fill-extrusion-base'),
              gradient: map.getPaintProperty(layerId, 'fill-extrusion-vertical-gradient'),
            };
            
            // Remove and re-add at end
            map.removeLayer(layerId);
            const readdConfig: any = {
              id: layerId,
              type: 'fill-extrusion',
              source: sourceId,
              minzoom: (layerConfig as any).minzoom || 12,
              paint: {
                'fill-extrusion-color': getColorExpression(viewMode, !!campaignId && viewMode !== 'qr'),
                'fill-extrusion-vertical-gradient': true,
                'fill-extrusion-height': currentPaint.height || ['coalesce', ['get', 'height'], ['get', 'height_m'], 10],
                'fill-extrusion-base': currentPaint.base || 0,
                'fill-extrusion-opacity': currentPaint.opacity || 1.0,
              },
            };
            // Only add filter if the original layer had one
            if ((layerConfig as any).filter) {
              readdConfig.filter = (layerConfig as any).filter;
            }
            map.addLayer(readdConfig); // No beforeId - adds at end (on top)
          }
        } catch (moveErr) {
          console.log('Layer move to end error:', moveErr);
        }
      } catch (err) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:502',message:'Error updating layer',data:{error:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        console.error('Error updating layer paint properties:', err);
      }
    }
    
      // Final verification - check layer state after all operations
      setTimeout(() => {
        const finalLayer = map.getLayer(layerId);
        const finalSource = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
        const finalSourceData = finalSource ? (finalSource as any)._data : null;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapBuildingsLayer.tsx:506',message:'Final layer check',data:{layerExists:!!finalLayer,sourceExists:!!finalSource,sourceHasData:!!finalSourceData,sourceFeatureCount:finalSourceData?.features?.length,currentZoom:map.getZoom(),layerMinzoom:finalLayer ? (finalLayer as any).minzoom : null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
      }, 100);
    }; // End of updateLayers function

    // Always attempt to run updateLayers - it will handle style loading state internally
    // If style isn't loaded yet, we also set up an idle listener as backup
    const styleLoaded = map.isStyleLoaded();
    console.log('[MapBuildingsLayer] Checking style loaded:', styleLoaded, 'features:', !!features);
    
    // Wrapper for idle listener so we can remove it
    const onIdle = () => {
      console.log('[MapBuildingsLayer] Idle event fired, running updateLayers');
      updateLayers();
    };
    
    // Wrapper for style.load listener
    const onStyleLoad = () => {
      console.log('[MapBuildingsLayer] Style load event fired, running updateLayers');
      updateLayers();
    };
    
    if (styleLoaded) {
      // Style is ready - run immediately
      console.log('[MapBuildingsLayer] Style loaded, running updateLayers immediately');
      updateLayers();
    } else {
      // Style not ready - set up idle listener as backup
      console.log('[MapBuildingsLayer] Style not loaded, setting up idle listener');
      map.once('idle', onIdle);
    }
    
    // Also listen for style.load to handle style changes (e.g., switching map themes)
    map.on('style.load', onStyleLoad);

    // Cleanup listeners
    return () => {
      map.off('idle', onIdle);
      map.off('style.load', onStyleLoad);
    };
  }, [map, features, zoomLevel, onBuildingClick, viewMode, campaignId, supabase, onAddToCRM, showOrphans]);

  // Update color when viewMode or campaignId changes (stable linker uses feature_status when campaignId set)
  useEffect(() => {
    if (!map || !map.getLayer(layerId)) return;
    
    try {
      const colorExpr = getColorExpression(viewMode, !!campaignId && viewMode !== 'qr');
      console.log('[MapBuildingsLayer] Updating color for viewMode/campaignId change', { viewMode, campaignId, colorExpr });
      map.setPaintProperty(layerId, 'fill-extrusion-color', colorExpr);
    } catch (err) {
      console.error('[MapBuildingsLayer] Error updating color for viewMode:', err);
    }
  }, [map, viewMode, campaignId, layerId]);

  // Update filter when showOrphans changes (toggle visibility of orphan buildings)
  useEffect(() => {
    if (!map) return;
    
    const updateFilters = () => {
      const filterExpr = getFilterExpression(showOrphans, !!campaignId);
      console.log('[MapBuildingsLayer] Updating filter for showOrphans change', { showOrphans, campaignId, filterExpr });
      
      try {
        if (map.getLayer(layerId)) {
          map.setFilter(layerId, filterExpr);
        }
      } catch (err) {
        console.error('[MapBuildingsLayer] Error updating filter for showOrphans:', err);
      }
    };

    // Apply immediately if map is loaded
    if (map.loaded()) {
      updateFilters();
    } else {
      map.once('load', updateFilters);
    }

    return () => {
      map.off('load', updateFilters);
    };
  }, [map, showOrphans, campaignId, layerId]);

  // Re-apply lighting and refresh colors when map style loads (important for dark mode)
  useEffect(() => {
    if (!map) return;

    const applyLightingAndColors = () => {
      try {
        // Apply lighting for 3D depth
        map.setLight({
          anchor: 'map', // Use 'map' anchor to avoid viewport anchor warnings
          color: 'white',
          intensity: 0.6, // Increased intensity for better visibility on dark backgrounds
          position: [1.15, 210, 30]
        });

        // Refresh colors after style change (ensures they're applied correctly)
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'fill-extrusion-color', getColorExpression(viewMode, !!campaignId && viewMode !== 'qr'));
          map.setPaintProperty(layerId, 'fill-extrusion-opacity', 1.0);
          map.setPaintProperty(layerId, 'fill-extrusion-vertical-gradient', true);
        }
      } catch (err) {
        console.warn('[MapBuildingsLayer] Error applying lighting/colors:', err);
      }
    };

    // Apply immediately if map is loaded
    if (map.loaded()) {
      applyLightingAndColors();
    }

    // Also apply when style loads (e.g., when switching between light/dark modes)
    map.once('style.load', applyLightingAndColors);

    return () => {
      map.off('style.load', applyLightingAndColors);
    };
  }, [map, viewMode, layerId]);

  // Real-time subscription for building_stats updates
  // When a QR code is scanned, building_stats is updated via trigger
  // This subscription catches that change and updates the map colors instantly
  // Uses setFeatureState() for efficient real-time updates (no full re-render)
  useEffect(() => {
    if (!map || !campaignId) return;

    const channel = supabase
      .channel(`building-stats-realtime-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'building_stats',
        },
        (payload) => {
          if (payload.new && isMountedRef.current) {
            const newProps = payload.new as any;
            const updatedGersId = newProps.gers_id;
            const newStatus = newProps.status;
            
            console.log('[MapBuildingsLayer] Real-time building_stats update:', {
              gers_id: updatedGersId,
              status: newStatus,
              scans_total: newProps.scans_total,
            });
            
            // Use setFeatureState for instant color update (no full re-render)
            // This is much more efficient than source.setData() for single feature updates
            if (updatedGersId && newStatus) {
              try {
                map.setFeatureState(
                  { source: sourceId, id: updatedGersId },
                  { status: newStatus }
                );
                console.log('[MapBuildingsLayer] setFeatureState:', updatedGersId, '->', newStatus);
              } catch (err) {
                console.warn('[MapBuildingsLayer] setFeatureState error (feature may not exist yet):', err);
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [map, campaignId, supabase]);

  // Real-time subscription for building_address_links (stable linker: map snaps grey → red as links are added)
  useEffect(() => {
    if (!map || !campaignId) return;

    const channel = supabase
      .channel(`building-links-realtime-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'building_address_links',
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => {
          if (!isMountedRef.current) return;
          // Re-fetch full campaign data to include the new link
          // This ensures feature_status updates from 'orphan_building' to 'matched'
          console.log('[MapBuildingsLayer] New building link detected, refreshing campaign data');
          fetchCampaignData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [map, campaignId, supabase, fetchCampaignData]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (fetchTimeout.current) {
        clearTimeout(fetchTimeout.current);
      }
      if (map) {
        try {
          if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
          }
          if (map.getLayer(shadowLayerId)) {
            map.removeLayer(shadowLayerId);
          }
          if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
          }
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    };
  }, [map]);

  return null; // This component doesn't render anything directly
}
