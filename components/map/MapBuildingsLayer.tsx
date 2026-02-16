'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Map } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
import { createClient } from '@/lib/supabase/client';
import type { BuildingFeatureCollection, BuildingFeature, BuildingProperties, GetBuildingsInBboxParams } from '@/types/map-buildings';
import { MAP_STATUS_CONFIG, type StatusFilters } from '@/lib/constants/mapStatus';

interface MapBuildingsLayerProps {
  map: Map;
  campaignId?: string | null;
  statusFilters?: StatusFilters;
  showOrphans?: boolean; // Toggle to show/hide orphan buildings (buildings without address links)
  onBuildingClick?: (buildingId: string, addressId?: string) => void;
  onAddToCRM?: (data: { address: string; addressId?: string; gersId?: string; campaignId?: string }) => void;
}

const defaultStatusFilters: StatusFilters = {
  QR_SCANNED: true,
  CONVERSATIONS: true,
  TOUCHED: true,
  UNTOUCHED: true,
};

/** Scale factor for building footprints (1 = unchanged, <1 = skinnier). */
const FOOTPRINT_SCALE = 0.65;

/**
 * Scale a polygon ring toward a centroid by a factor (in place).
 */
function scaleRing(
  ring: number[][],
  cx: number,
  cy: number,
  scale: number
): void {
  for (let i = 0; i < ring.length; i++) {
    ring[i][0] = cx + (ring[i][0] - cx) * scale;
    ring[i][1] = cy + (ring[i][1] - cy) * scale;
  }
}

/**
 * Compute centroid of a ring (average of coordinates).
 */
function ringCentroid(ring: number[][]): [number, number] {
  let sx = 0, sy = 0, n = ring.length;
  if (n === 0) return [0, 0];
  for (let i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return [sx / n, sy / n];
}

/**
 * Scale polygon or multi-polygon geometry toward its centroid(s) to make footprints skinnier.
 */
function scaleFootprint(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, scale: number): void {
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates;
    if (coords.length > 0) {
      const [cx, cy] = ringCentroid(coords[0]);
      coords.forEach((ring) => scaleRing(ring, cx, cy, scale));
    }
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((poly) => {
      if (poly.length > 0) {
        const [cx, cy] = ringCentroid(poly[0]);
        poly.forEach((ring) => scaleRing(ring, cx, cy, scale));
      }
    });
  }
}

export function MapBuildingsLayer({ map, campaignId, statusFilters = defaultStatusFilters, showOrphans = true, onBuildingClick, onAddToCRM }: MapBuildingsLayerProps) {
  const [features, setFeatures] = useState<BuildingFeatureCollection | null>(null);
  const [zoomLevel, setZoomLevel] = useState(15);
  const sourceId = 'map-buildings-source';
  const layerId = 'map-buildings-extrusion';
  const shadowLayerId = 'map-buildings-shadow';
  const supabase = createClient();
  
  // Debounce fetching to prevent spamming Supabase during rapid panning
  const fetchTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const isMountedRef = useRef(true);

  // Generate filter expression based on showOrphans toggle and statusFilters
  // When showOrphans=false in campaign mode, only show buildings with feature_status='matched'
  // StatusFilters control which status categories are visible
  // NOTE: fill-extrusion layers don't need geometry type filter - they only render polygon-like geometries
  const getFilterExpression = (showAll: boolean, isCampaignMode: boolean, filters: StatusFilters): any[] | undefined => {
    // Build status visibility conditions based on filters
    const statusConditions: any[] = [];
    
    // Helper to get effective status for a feature
    // Priority: QR_SCANNED (scans_total > 0) > CONVERSATIONS (hot) > TOUCHED (visited) > UNTOUCHED (not_visited)
    // Check feature-state first (real-time updates), then source properties (initial load)
    const getStatusValue = () => ['coalesce', ['feature-state', 'status'], ['get', 'status'], 'not_visited'];
    const getScansTotal = () => ['coalesce', ['feature-state', 'scans_total'], ['get', 'scans_total'], 0];
    const getQrScanned = () => ['coalesce', ['feature-state', 'qr_scanned'], ['get', 'qr_scanned'], false];
    
    // QR_SCANNED: qr_scanned === true OR scans_total > 0
    const isQrScanned = ['any', ['==', getQrScanned(), true], ['>', getScansTotal(), 0]];
    // CONVERSATIONS: status === 'hot' AND not QR scanned
    const isConversation = ['all', ['==', getStatusValue(), 'hot'], ['!', isQrScanned]];
    // TOUCHED: status === 'visited' AND not QR scanned
    const isTouched = ['all', ['==', getStatusValue(), 'visited'], ['!', isQrScanned]];
    // UNTOUCHED: status === 'not_visited' (default)
    const isUntouched = ['==', getStatusValue(), 'not_visited'];
    
    // Add conditions for enabled statuses
    if (filters.QR_SCANNED) statusConditions.push(isQrScanned);
    if (filters.CONVERSATIONS) statusConditions.push(isConversation);
    if (filters.TOUCHED) statusConditions.push(isTouched);
    if (filters.UNTOUCHED) statusConditions.push(isUntouched);
    
    // If no statuses enabled, hide all features
    if (statusConditions.length === 0) {
      return ['==', 1, 0]; // Always false - hide everything
    }
    
    // If all statuses enabled, check orphan filter only
    const allEnabled = filters.QR_SCANNED && filters.CONVERSATIONS && filters.TOUCHED && filters.UNTOUCHED;
    
    // Combine with orphan filter if in campaign mode
    if (isCampaignMode && !showAll) {
      // Campaign mode with showOrphans=false: only show matched buildings AND matching status
      if (allEnabled) {
        return ['==', ['get', 'feature_status'], 'matched'];
      }
      return ['all', 
        ['==', ['get', 'feature_status'], 'matched'],
        ['any', ...statusConditions]
      ];
    }
    
    // If all statuses enabled and not filtering orphans, no filter needed
    if (allEnabled) {
      return undefined;
    }
    
    // Return status filter only
    return ['any', ...statusConditions];
  };

  // Generate unified color expression based on status priority
  // Priority: QR_SCANNED > CONVERSATIONS > TOUCHED > UNTOUCHED
  // Uses ['feature-state', ...] for real-time updates via setFeatureState(),
  // with fallback to ['get', ...] for initial data from properties
  const getColorExpression = (): any => {
    // Helper expressions - check feature-state first (real-time), then source properties (initial load)
    const getStatusValue = () => ['coalesce', ['feature-state', 'status'], ['get', 'status'], 'not_visited'];
    const getScansTotal = () => ['coalesce', ['feature-state', 'scans_total'], ['get', 'scans_total'], 0];
    const getQrScanned = () => ['coalesce', ['feature-state', 'qr_scanned'], ['get', 'qr_scanned'], false];
    
    return [
      'case',
      // QR_SCANNED (highest priority): qr_scanned === true OR scans_total > 0
      ['any', ['==', getQrScanned(), true], ['>', getScansTotal(), 0]],
      MAP_STATUS_CONFIG.QR_SCANNED.color, // Purple
      
      // CONVERSATIONS: status === 'hot'
      ['==', getStatusValue(), 'hot'],
      MAP_STATUS_CONFIG.CONVERSATIONS.color, // Blue
      
      // TOUCHED: status === 'visited'
      ['==', getStatusValue(), 'visited'],
      MAP_STATUS_CONFIG.TOUCHED.color, // Green
      
      // UNTOUCHED (default): status === 'not_visited' or fallback
      MAP_STATUS_CONFIG.UNTOUCHED.color // Red
    ] as any;
  };

  // Track if campaign data has been loaded (for "fetch once, render forever" pattern)
  const campaignDataLoadedRef = useRef<string | null>(null);

  useEffect(() => {
  }, [map, campaignId]);

  // CAMPAIGN MODE: Fetch ALL campaign features once (no viewport filtering)
  // This enables "fetch once, render forever" for buttery smooth pan/zoom
  // Load BOTH: split units (Supabase) + parent buildings (S3). Merge: use units when available, else parent building (detached).
  const fetchCampaignData = useCallback(async () => {
    if (!isMountedRef.current || !campaignId) return;

    console.log('[MapBuildingsLayer] Campaign Mode: Fetching full campaign data', { campaignId });

    try {
      // Fetch units from Supabase and buildings from our API (avoids expired S3 URLs)
      const { data: units, error: unitsError } = await supabase
        .from('building_units')
        .select('*, campaign_addresses(house_number, street_name, formatted)')
        .eq('campaign_id', campaignId);

      // Check if we have a snapshot by trying the API
      const buildingsResponse = await fetch(`/api/campaigns/${campaignId}/buildings`);
      const parentBuildings = buildingsResponse.ok ? await buildingsResponse.json() : null;
      const hasBuildings = parentBuildings?.features?.length > 0;

      console.log('[MapBuildingsLayer] Data loaded:', {
        unitsCount: units?.length || 0,
        unitsError: unitsError?.message,
        hasBuildings,
        buildingCount: parentBuildings?.features?.length || 0,
      });

      // If we have buildings from S3, merge: units for multi-unit buildings, parent building for detached.
      // Publish every fetched building (no dropping); visibility is controlled via layer filter / feature stats.
      if (hasBuildings) {
        const parentFeatures = parentBuildings?.features ?? [];

        const mergedFeatures: BuildingFeature[] = [];

        console.log('[MapBuildingsLayer] Merging units with parent buildings:', {
          parentBuildings: parentFeatures.length,
          units: units?.length || 0,
        });

        for (const b of parentFeatures) {
          // S3 buildings have gers_id in properties, not id at feature level
          const gersId = b.properties?.gers_id;                  // GERS ID (for matching units)
          const buildingUnits = !unitsError && units?.length
            ? units.filter((u: { parent_building_id: string }) => u.parent_building_id === gersId)
            : [];
          
          if (buildingUnits.length > 0 || parentFeatures.length <= 3) {
            console.log('[MapBuildingsLayer] Building merge:', {
              gersId: gersId?.slice(0, 20),
              unitCount: buildingUnits.length,
            });
          }

          if (buildingUnits.length > 0) {
            // Multi-unit: emit one feature per slice (use unit geometry and address)
            // Add slight height offset so units are visually distinct
            buildingUnits.forEach((u, index) => {
              const heightOffset = index * 0.5; // Each unit 0.5m higher
              mergedFeatures.push({
                type: 'Feature',
                id: u.id,
                geometry: u.unit_geometry as GeoJSON.Polygon,
                properties: {
                  ...(b.properties || {}),
                  height: (b.properties?.height || 10) + heightOffset, // Stagger heights
                  gers_id: gersId,  // Parent building GERS ID
                  feature_id: u.id,
                  unit_id: u.id,
                  unit_number: u.unit_number,
                  address_id: u.address_id,
                  status: u.status,
                  parent_type: u.parent_type,
                  house_number: u.campaign_addresses?.house_number,
                  street_name: u.campaign_addresses?.street_name,
                  address_text: u.campaign_addresses?.formatted ?? (b.properties?.address_text),
                  layer: 'units',
                } as Partial<BuildingProperties> as BuildingProperties,
              } as BuildingFeature);
            });
          } else {
            // Single-family detached: emit parent building as-is with unique feature_id for Mapbox
            const fid = gersId ?? b.id ?? crypto.randomUUID();
            mergedFeatures.push({
              type: 'Feature',
              id: fid,
              geometry: b.geometry,
              properties: {
                ...(b.properties || {}),
                gers_id: gersId,
                feature_id: fid,
                layer: 'buildings',
              } as Partial<BuildingProperties> as BuildingProperties,
            } as BuildingFeature);
          }
        }

        if (isMountedRef.current) {
          const collection: BuildingFeatureCollection = {
            type: 'FeatureCollection',
            features: mergedFeatures,
          };
          console.log('[MapBuildingsLayer] Merged units + detached:', {
            featuresCount: mergedFeatures.length,
            unitFeatures: mergedFeatures.filter((f: BuildingFeature) => f.properties?.unit_id).length,
            detachedFeatures: mergedFeatures.filter((f: BuildingFeature) => !f.properties?.unit_id).length,
            campaignId,
            mode: 'merged-snapshot',
          });
          campaignDataLoadedRef.current = campaignId;
          setFeatures(collection);
          return;
        }
      }

      // No S3 snapshot: if we have units only, show just units (legacy)
      if (!unitsError && units && units.length > 0) {
        const unitsGeoJSON: BuildingFeatureCollection = {
          type: 'FeatureCollection',
          features: units.map((u: { id: string; unit_geometry: GeoJSON.Polygon; parent_building_id: string; unit_number: number; address_id: string | null; status: string; parent_type: string; campaign_addresses?: { house_number: string | null; street_name: string | null; formatted: string | null } }) => ({
            type: 'Feature' as const,
            id: u.id,
            geometry: u.unit_geometry as GeoJSON.Polygon,
            properties: {
              gers_id: u.parent_building_id,
              feature_id: u.id,
              unit_id: u.id,
              unit_number: u.unit_number,
              address_id: u.address_id,
              status: u.status,
              parent_type: u.parent_type,
              house_number: u.campaign_addresses?.house_number,
              street_name: u.campaign_addresses?.street_name,
              address_text: u.campaign_addresses?.formatted,
              layer: 'units',
            } as Partial<BuildingProperties> as BuildingProperties,
          })) as BuildingFeature[],
        };
        if (isMountedRef.current) {
          campaignDataLoadedRef.current = campaignId;
          setFeatures(unitsGeoJSON);
          return;
        }
      }

      // FALLBACK: Legacy mode
      console.log('[MapBuildingsLayer] Falling back to Supabase RPC');
      
      const { data, error } = await supabase.rpc('rpc_get_campaign_full_features', {
        p_campaign_id: campaignId
      });

      if (error) {
        console.error('[MapBuildingsLayer] Error fetching campaign data:', error);
        return;
      }

      if (data && isMountedRef.current) {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        console.log('[MapBuildingsLayer] Campaign data loaded:', {
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
    console.log('[MapBuildingsLayer] Campaign fetch effect running:', { 
      hasMap: !!map, 
      campaignId, 
      alreadyLoaded: campaignDataLoadedRef.current 
    });
    
    if (!map || !campaignId) {
      console.log('[MapBuildingsLayer] Skipping fetch - missing map or campaignId:', { hasMap: !!map, campaignId });
      return;
    }
    
    // Only fetch if we haven't already loaded this campaign's data
    if (campaignDataLoadedRef.current === campaignId) {
      console.log('[MapBuildingsLayer] Campaign data already loaded, skipping fetch');
      return;
    }

    const doFetch = () => {
      console.log('[MapBuildingsLayer] doFetch called, map.loaded():', map.loaded(), 'isStyleLoaded:', map.isStyleLoaded());
      
      // Use isStyleLoaded() which is sufficient for our RPC call
      // map.loaded() waits for ALL resources (tiles, etc.) which takes too long
      if (map.isStyleLoaded()) {
        console.log('[MapBuildingsLayer] Style loaded, fetching campaign data now');
        setZoomLevel(map.getZoom());
        fetchCampaignData();
      } else {
        console.log('[MapBuildingsLayer] Style not loaded, waiting for style.load event');
        // Use 'style.load' event which fires when style is ready (more reliable than 'load')
        map.once('style.load', () => {
          console.log('[MapBuildingsLayer] style.load event fired, fetching data');
          setZoomLevel(map.getZoom());
          fetchCampaignData();
        });
        
        // Fallback: Also try 'idle' event in case style.load already fired
        const idleHandler = () => {
          if (!campaignDataLoadedRef.current) {
            console.log('[MapBuildingsLayer] idle event fired, fetching data as fallback');
            setZoomLevel(map.getZoom());
            fetchCampaignData();
          }
          map.off('idle', idleHandler);
        };
        map.once('idle', idleHandler);
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

      // Ensure every feature has feature_id for promoteId (required for setFeatureState)
      // Scale footprints toward centroid so markers appear skinnier on the map
      const normalizedFeatures: BuildingFeatureCollection | null = features
        ? {
            type: 'FeatureCollection',
            features: features.features.map((f) => {
              const props = f.properties ?? {};
              const fid = props.feature_id ?? props.gers_id ?? f.id ?? (props as any).id;
              const geom = f.geometry;
              const scaledGeom =
                geom?.type === 'Polygon' || geom?.type === 'MultiPolygon'
                  ? (JSON.parse(JSON.stringify(geom)) as GeoJSON.Polygon | GeoJSON.MultiPolygon)
                  : geom;
              if (scaledGeom && (scaledGeom.type === 'Polygon' || scaledGeom.type === 'MultiPolygon')) {
                scaleFootprint(scaledGeom, FOOTPRINT_SCALE);
              }
              return {
                ...f,
                geometry: (scaledGeom ?? geom) as GeoJSON.Polygon,
                properties: { ...props, feature_id: fid ?? (f as any).id },
              };
            }),
          } as BuildingFeatureCollection
        : null;

      // If source already exists and we have features, update the data immediately
      // This handles the race condition where features arrive after source was created
      if (source && normalizedFeatures) {
        console.log('[MapBuildingsLayer] Updating existing source with', normalizedFeatures.features.length, 'features');
        source.setData(normalizedFeatures);
      }

      // Check if we should proceed with layer creation/updates
      if (!normalizedFeatures || normalizedFeatures.features.length === 0 || zoomLevel < 12) {
        console.log('[MapBuildingsLayer] Skipping layer creation:', { hasFeatures: !!features, featuresCount: features?.features?.length, zoomLevel });
        return;
      }

      // Create source if it doesn't exist yet (source update already handled above)
      if (!source) {
        try {
          map.addSource(sourceId, {
            type: 'geojson',
            data: normalizedFeatures,
            // promoteId enables setFeatureState() for real-time color updates
            // Use feature_id (unique per feature: unit id or gers_id for detached)
            promoteId: 'feature_id',
            // Buffer extends tile loading 512px beyond viewport edge
            // This prevents edge-clipping when panning in campaign mode
            buffer: 512,
            // Tolerance for geometry simplification (smaller = more detail)
            tolerance: 0.5,
          });
        } catch (err) {
          console.error('Error adding source:', err);
          return;
        }
      }

      // Add or update fill-extrusion layer
    if (!map.getLayer(layerId)) {
      try {
        // NOTE: Shadow layer removed to fix "dark square" visual artifact
        // The 3D fill-extrusion with proper lighting provides sufficient visual depth
        const filterExpr = getFilterExpression(showOrphans, !!campaignId, statusFilters);

        // Add the main building layer
        // Add without beforeId to place at end (on top of everything, including labels)
        const layerConfig: any = {
          id: layerId,
          type: 'fill-extrusion' as const,
          source: sourceId,
          minzoom: 12,
          paint: {
            'fill-extrusion-color': getColorExpression(),
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

        // Outline layer removed to eliminate dark shadow effect underneath buildings

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
        
        
        console.log('[MapBuildingsLayer] Building layer added successfully', {
          layerId,
          featuresCount: normalizedFeatures.features.length,
          zoomLevel,
          layerExists: !!addedLayer,
          opacity: paintOpacity,
          currentZoom,
          statusFilters,
          colorExpression: getColorExpression(),
          sampleFeatureStatus: normalizedFeatures.features[0]?.properties?.status,
        });
        

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
            default: return '#dc2626';
          }
        };

        // Add click handler to fetch and display resident data
        const clickHandler = async (e: mapboxgl.MapLayerMouseEvent) => {
          console.log('[MapBuildingsLayer] Click event:', {
            featureCount: e.features?.length,
            point: e.point,
          });
          
          if (!e.features || e.features.length === 0) {
            console.log('[MapBuildingsLayer] No features at click location');
            return;
          }
          
          const feature = e.features[0];
          const props = feature.properties as BuildingProperties;
          
          const gersId = props.gers_id;
          
          // UNIT MODE: If this is a unit slice, pass address_id to show specific unit
          if (props.unit_id && props.address_id && onBuildingClick) {
            console.log('[MapBuildingsLayer] Unit clicked:', {
              unit_id: props.unit_id,
              unit_number: props.unit_number,
              address_id: props.address_id,
              address_text: props.address_text,
            });
            
            // Pass both gersId (parent building) and address_id (specific unit)
            onBuildingClick(gersId, props.address_id);
            return; // Early return - we've handled the click
          }
          
          // If no gers_id, fall back to onBuildingClick with id
          if (!gersId) {
            console.log('[MapBuildingsLayer] No gers_id, using fallback');
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
            
            // Unit header - show unit number/house number prominently for slices (red accent)
            const unitHeader = props.unit_number 
              ? `<div style="background: #dc2626; color: white; padding: 8px 12px; margin: -12px -12px 12px -12px; font-weight: 600; font-size: 18px;">🏠 Unit ${escapeHtml(props.unit_number)}</div>`
              : '';
            const addressHeader = addressInfo.address 
              ? `<div style="font-weight: 500; margin-bottom: 8px; color: #374151;">${escapeHtml(addressInfo.address)}</div>` 
              : '';
            
            if (contacts && contacts.length > 0) {
              popupContent = '<div style="padding: 12px; max-width: 300px;">';
              popupContent += unitHeader;
              popupContent += addressHeader;
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
              // No contacts found - show "Add to Leads" button
              const addressDisplay = addressInfo.address ? escapeHtml(addressInfo.address) : 'this address';
              popupContent = '<div style="padding: 12px; max-width: 280px;">';
              popupContent += unitHeader;
              popupContent += addressHeader;
              if (props.match_method) {
                popupContent += '<div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 6px;">Linked via: ' + escapeHtml(props.match_method) + '</div>';
              }
              popupContent += '<div style="font-weight: 600; margin-bottom: 6px; font-size: 16px;">No Resident Data</div>';
              popupContent += `<div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 12px;">No resident data available for ${addressDisplay}.</div>`;
              
              if (onAddToCRM) {
                // Generate unique ID for this button
                buttonId = `add-to-crm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                popupContent += `<button id="${buttonId}" style="width: 100%; background: #dc2626; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 500; font-size: 0.875rem; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#b91c1c'" onmouseout="this.style.background='#dc2626'">Add to Leads</button>`;
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

            // If "Add to Leads" button exists, attach click handler
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
        console.error('Error adding fill-extrusion layer:', err);
      }
    } else {
        // Update paint properties for existing layer to ensure opacity is correct
        try {
        const colorExpr = getColorExpression();
        console.log('[MapBuildingsLayer] Updating existing layer colors', {
          statusFilters,
          colorExpression: colorExpr,
          layerId,
        });
        map.setPaintProperty(layerId, 'fill-extrusion-opacity', 1.0);
        map.setPaintProperty(layerId, 'fill-extrusion-color', colorExpr);
        map.setPaintProperty(layerId, 'fill-extrusion-vertical-gradient', true);
        
        
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
                'fill-extrusion-color': getColorExpression(),
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
        console.error('Error updating layer paint properties:', err);
      }
    }
    
      // Final verification - check layer state after all operations
      setTimeout(() => {
        const finalLayer = map.getLayer(layerId);
        const finalSource = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
        const finalSourceData = finalSource ? (finalSource as any)._data : null;
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
  }, [map, features, zoomLevel, onBuildingClick, statusFilters, campaignId, supabase, onAddToCRM, showOrphans]);

  // Update color and filter when statusFilters or campaignId changes
  useEffect(() => {
    if (!map || !map.getLayer(layerId)) return;
    
    try {
      const colorExpr = getColorExpression();
      const filterExpr = getFilterExpression(showOrphans, !!campaignId, statusFilters);
      console.log('[MapBuildingsLayer] Updating color/filter for statusFilters change', { statusFilters, campaignId, colorExpr, filterExpr });
      map.setPaintProperty(layerId, 'fill-extrusion-color', colorExpr);
      map.setFilter(layerId, filterExpr);
    } catch (err) {
      console.error('[MapBuildingsLayer] Error updating color/filter:', err);
    }
  }, [map, statusFilters, campaignId, layerId, showOrphans]);

  // Update filter when showOrphans changes (toggle visibility of orphan buildings)
  useEffect(() => {
    if (!map) return;
    
    const updateFilters = () => {
      const filterExpr = getFilterExpression(showOrphans, !!campaignId, statusFilters);
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
  }, [map, showOrphans, campaignId, statusFilters, layerId]);

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
          map.setPaintProperty(layerId, 'fill-extrusion-color', getColorExpression());
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
  }, [map, layerId]);

  // Real-time subscription for building_stats updates
  // When a QR code is scanned, building_stats is updated via trigger
  // This subscription catches that change and updates the map colors instantly
  // Uses setFeatureState() for efficient real-time updates (no full re-render)
  useEffect(() => {
    if (!map || !campaignId) return;

    console.log('[MapBuildingsLayer] Setting up real-time subscription for building_stats, campaignId:', campaignId);

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
          console.log('[MapBuildingsLayer] Received building_stats change:', payload);
          
          if (payload.new && isMountedRef.current) {
            const newProps = payload.new as any;
            const updatedGersId = newProps.gers_id;
            const newStatus = newProps.status;
            const scansTotal = newProps.scans_total || 0;
            
            console.log('[MapBuildingsLayer] Real-time building_stats update:', {
              gers_id: updatedGersId,
              status: newStatus,
              scans_total: scansTotal,
              payload_type: payload.eventType,
            });
            
            // Use setFeatureState for instant color update (no full re-render)
            // Features use promoteId: 'feature_id' (unit id or gers_id for detached). building_stats is keyed by gers_id.
            // So we update every feature whose gers_id matches (one for detached, multiple for unit slices).
            if (updatedGersId) {
              try {
                const featureState = { 
                  status: newStatus,
                  scans_total: scansTotal,
                  qr_scanned: scansTotal > 0, // Mark as QR scanned if any scans
                };
                const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource & { _data?: GeoJSON.FeatureCollection } | undefined;
                const data = source?._data;
                const featuresToUpdate = data?.features?.filter(
                  (f: GeoJSON.Feature) => (f.properties as any)?.gers_id === updatedGersId
                ) ?? [];
                const ids = featuresToUpdate
                  .map((f: GeoJSON.Feature) => (f.properties as any)?.feature_id)
                  .filter(Boolean);
                if (ids.length === 0) {
                  // Fallback: treat gers_id as feature id (detached or legacy data without feature_id)
                  ids.push(updatedGersId);
                }
                for (const id of ids) {
                  map.setFeatureState({ source: sourceId, id }, featureState);
                }
                console.log('[MapBuildingsLayer] setFeatureState success:', updatedGersId, '->', ids.length, 'features', featureState);
              } catch (err) {
                console.warn('[MapBuildingsLayer] setFeatureState error (feature may not exist yet):', err);
              }
            } else {
              console.warn('[MapBuildingsLayer] No gers_id in building_stats update - cannot update feature state');
            }
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[MapBuildingsLayer] Realtime subscription status:', status);
        if (err) {
          console.error('[MapBuildingsLayer] Realtime subscription error:', err);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [map, campaignId, supabase]);

  // Real-time subscription for scan_events (direct scan tracking)
  // This is a fallback in case building_stats trigger fails or realtime isn't enabled
  useEffect(() => {
    if (!map || !campaignId) return;

    console.log('[MapBuildingsLayer] Setting up real-time subscription for scan_events, campaignId:', campaignId);

    const channel = supabase
      .channel(`scan-events-realtime-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'scan_events',
          filter: `campaign_id=eq.${campaignId}`,
        },
        async (payload) => {
          console.log('[MapBuildingsLayer] Received scan_event INSERT:', payload);
          
          if (payload.new && isMountedRef.current) {
            const newScan = payload.new as any;
            const buildingId = newScan.building_id;
            
            // Look up the gers_id for this building
            if (buildingId) {
              try {
                const { data: building, error } = await supabase
                  .from('buildings')
                  .select('gers_id')
                  .eq('id', buildingId)
                  .single();
                
                if (building?.gers_id) {
                  console.log('[MapBuildingsLayer] Found gers_id for building:', building.gers_id);
                  
                  // Update feature state to show as QR scanned
                  const featureState = { 
                    status: 'visited',
                    scans_total: 1, // At least 1 scan
                    qr_scanned: true,
                  };
                  
                  map.setFeatureState(
                    { source: sourceId, id: building.gers_id },
                    featureState
                  );
                  console.log('[MapBuildingsLayer] setFeatureState from scan_events:', building.gers_id, '->', featureState);
                } else {
                  console.warn('[MapBuildingsLayer] Could not find gers_id for building:', buildingId, error);
                }
              } catch (err) {
                console.error('[MapBuildingsLayer] Error looking up building gers_id:', err);
              }
            }
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[MapBuildingsLayer] scan_events subscription status:', status);
        if (err) {
          console.error('[MapBuildingsLayer] scan_events subscription error:', err);
        }
      });

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
