'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { CampaignAddress } from '@/types/database';
import { MapService } from '@/lib/services/MapService';

export function CampaignDetailMapView({
  campaignId,
  addresses,
}: {
  campaignId: string;
  addresses: CampaignAddress[];
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || 'pk.eyJ1IjoiZmx5cnBybyIsImEiOiJjbWd6dzZsbm0wYWE3ZWpvbjIwNGVteDV6In0.lvbLszJ7ADa_Cck3A8hZEQ';
    mapboxgl.accessToken = token;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/flyrpro/cmie253op00fa01qmgiri8lcb', // Light 3D Style
      center: addresses.length > 0 && addresses[0].coordinate
        ? [addresses[0].coordinate.lon, addresses[0].coordinate.lat]
        : [-79.3832, 43.6532],
      zoom: 12,
    });

    map.current.on('load', () => {
      setMapLoaded(true);
      
      // Clean up problematic layers and hide building layers
      const cleanupLayers = () => {
        if (!map.current) return;
        
        try {
          const style = map.current.getStyle();
          if (style && style.layers) {
            style.layers.forEach((layer) => {
              // Hide layers that contain "building" in their id
              if (layer.id.toLowerCase().includes('building')) {
                map.current?.setLayoutProperty(layer.id, 'visibility', 'none');
              }
              
              // Remove layers that reference non-existent source layers
              if (layer.id && (
                layer.id.includes('road-label') || 
                layer.id.includes('road_label')
              )) {
                try {
                  map.current.removeLayer(layer.id);
                } catch (err) {
                  // Layer might not exist or already removed
                }
              }
            });
          }
        } catch (err) {
          // Ignore cleanup errors
        }
      };
      
      cleanupLayers();
    });

    // Handle non-critical source layer errors
    map.current.on('error', (e) => {
      const errorMessage = e.error?.message || String(e.error);
      const isSourceLayerError = errorMessage.includes('does not exist on source') || 
                                 errorMessage.includes('Source layer');
      
      if (isSourceLayerError) {
        // This is a style validation error - log but don't show to user
        console.warn('Mapbox style layer warning (non-critical):', errorMessage);
        
        // Try to remove the problematic layer after style loads
        if (map.current) {
          map.current.once('style.load', () => {
            try {
              const style = map.current?.getStyle();
              if (style && style.layers) {
                style.layers.forEach((layer) => {
                  if (layer.id && (
                    layer.id.includes('road-label') || 
                    layer.id.includes('road_label')
                  )) {
                    try {
                      map.current?.removeLayer(layer.id);
                    } catch (removeErr) {
                      // Layer might already be removed
                    }
                  }
                });
              }
            } catch (cleanupErr) {
              // Ignore cleanup errors
            }
          });
        }
      }
    });

    return () => {
      map.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!map.current || !mapLoaded || addresses.length === 0) return;

    // Add markers for addresses
    addresses.forEach((address) => {
      if (address.coordinate) {
        const el = document.createElement('div');
        el.className = 'marker';
        el.style.width = '20px';
        el.style.height = '20px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = address.visited ? '#10b981' : '#3b82f6';
        el.style.border = '2px solid white';
        el.style.cursor = 'pointer';

        new mapboxgl.Marker(el)
          .setLngLat([address.coordinate.lon, address.coordinate.lat])
          .setPopup(
            new mapboxgl.Popup().setHTML(`
              <div>
                <p class="font-semibold">${address.address}</p>
                <p class="text-sm text-gray-600">${address.visited ? 'Visited' : 'Not visited'}</p>
              </div>
            `)
          )
          .addTo(map.current!);
      }
    });

    // Fit bounds to show all addresses
    if (addresses.some(a => a.coordinate)) {
      const bounds = new mapboxgl.LngLatBounds();
      addresses.forEach((address) => {
        if (address.coordinate) {
          bounds.extend([address.coordinate.lon, address.coordinate.lat]);
        }
      });
      map.current.fitBounds(bounds, { padding: 50 });
    }

    // Load building polygons
    const loadBuildings = async () => {
      const addressesWithCoords = addresses
        .filter(a => a.coordinate && a.id)
        .map(a => ({ id: a.id!, lat: a.coordinate!.lat, lon: a.coordinate!.lon }));

      if (addressesWithCoords.length > 0) {
        try {
          await MapService.requestBuildingPolygons(addressesWithCoords);
          // Fetch and render polygons
          const polygonIds = addressesWithCoords.map(a => a.id);
          const polygons = await MapService.fetchBuildingPolygons(polygonIds);
          
          // Render polygons on map
          if (polygons.length > 0 && map.current) {
            const geojson = {
              type: 'FeatureCollection' as const,
              features: polygons.map((polygon) => ({
                type: 'Feature' as const,
                geometry: JSON.parse(polygon.geom),
                properties: { address_id: polygon.address_id },
              })),
            };

            if (map.current.getSource('buildings')) {
              (map.current.getSource('buildings') as mapboxgl.GeoJSONSource).setData(geojson);
            } else {
              map.current.addSource('buildings', {
                type: 'geojson',
                data: geojson,
              });

              map.current.addLayer({
                id: 'buildings-fill',
                type: 'fill',
                source: 'buildings',
                paint: {
                  'fill-color': '#3b82f6',
                  'fill-opacity': 0.3,
                },
              });

              map.current.addLayer({
                id: 'buildings-line',
                type: 'line',
                source: 'buildings',
                paint: {
                  'line-color': '#3b82f6',
                  'line-width': 2,
                },
              });
            }
          }
        } catch (error) {
          console.error('Error loading building polygons:', error);
        }
      }
    };

    loadBuildings();
  }, [mapLoaded, addresses]);

  return <div ref={mapContainer} className="h-full w-full" />;
}

