'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CampaignType } from '@/types/database';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/theme-provider';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';
import { Satellite, Map, Trash2, Pencil } from 'lucide-react';
import * as turf from '@turf/turf';

// Mapbox v11/v12 styles with building footprints – used only on create campaign so we see buildings
const MAP_STYLES = {
  light: 'mapbox://styles/mapbox/streets-v12',
  dark: 'mapbox://styles/mapbox/dark-v11',
} as const;

export default function CreateCampaignPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const [name, setName] = useState('');
  const [type, setType] = useState<CampaignType>('flyer');
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState<string>('');
  const [generatingAddresses, setGeneratingAddresses] = useState(false);
  const [addressCount, setAddressCount] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  // Initialize map with drawing controls
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || 'pk.eyJ1IjoiZmx5cnBybyIsImEiOiJjbWd6dzZsbm0wYWE3ZWpvbjIwNGVteDV6In0.lvbLszJ7ADa_Cck3A8hZEQ';
    mapboxgl.accessToken = token;

    // Initialize map (style follows app theme)
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[theme] ?? MAP_STYLES.light,
      center: [-79.35, 43.65], // Default to Toronto area
      zoom: 12,
    });

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    // Initialize Mapbox Draw with red styling (no visible controls - draw by clicking)
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {}, // Hide all default controls to avoid duplicates
      defaultMode: 'draw_polygon',
      styles: [
        // Polygon fill
        {
          id: 'gl-draw-polygon-fill',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'fill-color': '#ef4444',
            'fill-outline-color': '#ef4444',
            'fill-opacity': 0.15,
          },
        },
        // Polygon outline stroke
        {
          id: 'gl-draw-polygon-stroke-active',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#ef4444',
            'line-width': 3,
          },
        },
        // Vertex points (the draggable circles)
        {
          id: 'gl-draw-polygon-and-line-vertex-active',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 4,
            'circle-color': '#ef4444',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
          },
        },
        // Midpoint vertices
        {
          id: 'gl-draw-polygon-midpoint',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
          paint: {
            'circle-radius': 4,
            'circle-color': '#ef4444',
          },
        },
        // Line while drawing
        {
          id: 'gl-draw-line-active',
          type: 'line',
          filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#ef4444',
            'line-width': 3,
            'line-dasharray': [0.2, 2],
          },
        },
        // Static polygon (after completion)
        {
          id: 'gl-draw-polygon-fill-static',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
          paint: {
            'fill-color': '#ef4444',
            'fill-outline-color': '#ef4444',
            'fill-opacity': 0.15,
          },
        },
        {
          id: 'gl-draw-polygon-stroke-static',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#ef4444',
            'line-width': 3,
          },
        },
      ],
    });

    map.current.addControl(draw);
    drawRef.current = draw;

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Store drawn features for restoration after style change
  const savedFeaturesRef = useRef<any>(null);

  // Handle map style change - recreate draw instance to avoid source conflicts
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Determine the correct style: satellite toggle or theme (light/dark)
    const expectedStyle = isSatellite 
      ? 'mapbox://styles/mapbox/satellite-streets-v12'
      : (MAP_STYLES[theme] ?? MAP_STYLES.light);

    // Get current style name (if available)
    const currentStyle = map.current.getStyle()?.name || '';
    const isCurrentlySatellite = currentStyle.toLowerCase().includes('satellite');
    
    // Skip if already on the correct style type
    if (isSatellite === isCurrentlySatellite && drawRef.current) return;

    // Save features before destroying draw
    if (drawRef.current) {
      try {
        savedFeaturesRef.current = drawRef.current.getAll();
        map.current.removeControl(drawRef.current);
        drawRef.current = null;
      } catch (e) {
        console.log('Error saving/removing draw:', e);
      }
    }

    // Change style
    map.current.setStyle(expectedStyle);

    // After style loads, create fresh draw instance
    map.current.once('style.load', () => {
      if (!map.current) return;

      // Create fresh draw instance
      const newDraw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: 'draw_polygon',
        styles: [
          { id: 'gl-draw-polygon-fill', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], paint: { 'fill-color': '#ef4444', 'fill-outline-color': '#ef4444', 'fill-opacity': 0.15 } },
          { id: 'gl-draw-polygon-stroke-active', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ef4444', 'line-width': 3 } },
          { id: 'gl-draw-polygon-and-line-vertex-active', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 4, 'circle-color': '#ef4444', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } },
          { id: 'gl-draw-polygon-midpoint', type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']], paint: { 'circle-radius': 4, 'circle-color': '#ef4444' } },
          { id: 'gl-draw-line-active', type: 'line', filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-dasharray': [0.2, 2] } },
          { id: 'gl-draw-polygon-fill-static', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']], paint: { 'fill-color': '#ef4444', 'fill-outline-color': '#ef4444', 'fill-opacity': 0.15 } },
          { id: 'gl-draw-polygon-stroke-static', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ef4444', 'line-width': 3 } },
        ],
      });

      map.current.addControl(newDraw);
      drawRef.current = newDraw;

      // Restore saved features
      if (savedFeaturesRef.current?.features?.length > 0) {
        newDraw.set(savedFeaturesRef.current);
        newDraw.changeMode('simple_select');
      } else {
        newDraw.changeMode('draw_polygon');
      }
    });
  }, [isSatellite, theme, mapLoaded]);

  const toggleSatelliteView = () => {
    setIsSatellite(!isSatellite);
  };

  const clearDrawing = () => {
    if (drawRef.current) {
      drawRef.current.deleteAll();
      drawRef.current.changeMode('draw_polygon');
    }
  };

  const startDrawing = () => {
    if (drawRef.current) {
      drawRef.current.changeMode('draw_polygon');
    }
  };

  const handleMapSearchSelect = (suggestion: AddressSuggestion) => {
    if (!map.current || !mapLoaded) return;
    
    map.current.flyTo({
      center: [suggestion.coordinate.longitude, suggestion.coordinate.latitude],
      zoom: 18,
      duration: 1500, // Smooth animation
    });
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!userId) return;

    // Get drawn polygon (map territory only)
    let polygon: { type: 'Polygon'; coordinates: number[][][] } | null = null;
    let bbox: number[] | undefined = undefined;
    const features = drawRef.current?.getAll();
if (!features || features.features.length === 0) {
      alert('Please draw a territory boundary on the map');
      return;
    }
    polygon = features.features[0].geometry as { type: 'Polygon'; coordinates: number[][][] };

    // Ensure valid polygon for Lambda (LinearRing needs >= 3 points, GeoJSON expects closed ring = 4+ positions)
    const ring = polygon.coordinates[0];
    if (!ring || ring.length < 3) {
      alert('Please draw a proper territory with at least 3 corners. The shape you drew has too few points.');
      return;
    }
    // Close the ring if unclosed (first and last must be equal per GeoJSON spec)
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length === 3 || (first[0] !== last[0] || first[1] !== last[1])) {
      polygon = {
        ...polygon,
        coordinates: [[...ring, [first[0], first[1]]]],
      };
    }

    // Calculate bbox from polygon using turf
    try {
      const turfPolygon = turf.polygon(polygon.coordinates);
      const calculatedBbox = turf.bbox(turfPolygon);
      bbox = [calculatedBbox[0], calculatedBbox[1], calculatedBbox[2], calculatedBbox[3]];
    } catch (bboxError) {
      console.error('Error calculating bbox from polygon:', bboxError);
    }

    setLoading(true);
    try {
      // Create campaign server-side so generate-address-list and provision find it in Supabase
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          address_source: 'map',
          bbox,
          territory_boundary: polygon || undefined,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create campaign (${createRes.status})`);
      }
      const campaign = await createRes.json();
      console.log('Campaign created:', campaign?.id, campaign?.name);

      // ADDRESS-FIRST LOGIC: Map Territory - Save addresses first, then provision
      if (polygon) {
        setGeneratingAddresses(true);
        try {
          console.log('Saving addresses from polygon...');
          
          // Step 1: Fetch and save addresses from polygon
          const addressResponse = await fetch('/api/campaigns/generate-address-list', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaign_id: campaign.id,
              polygon: polygon, // Pass polygon to generate addresses
            }),
          });

          if (!addressResponse.ok) {
            const error = await addressResponse.json();
            console.error('Address generation error:', error);
            alert(`Campaign created but address generation failed: ${error.error || 'Unknown error'}`);
          } else {
            const addressResult = await addressResponse.json();
            setAddressCount(addressResult.inserted_count || 0);
            console.log(`Saved ${addressResult.inserted_count} addresses from polygon`);
            
            if (addressResult.inserted_count > 0) {
              // Step 2: Provision buildings (no boundary needed - uses addresses)
              setGeneratingAddresses(false);
              setProvisioning(true);
              setProvisionProgress('Scanning 3D Shapes...');
              
              try {
                // Simulate progress updates
                const progressInterval = setInterval(() => {
                  setProvisionProgress((prev) => {
                    if (prev === 'Scanning 3D Shapes...') return 'Matching Addresses...';
                    if (prev === 'Matching Addresses...') return 'Finalizing Mission Territory...';
                    return prev;
                  });
                }, 2000);

                const provisionResponse = await fetch('/api/campaigns/provision', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    campaign_id: campaign.id,
                    // No boundary - will use addresses from campaign_addresses
                  }),
                });

                clearInterval(progressInterval);
                setProvisionProgress('Finalizing Mission Territory...');

                if (!provisionResponse.ok) {
                  const error = await provisionResponse.json();
                  console.error('Provisioning error:', error);
                  alert(`Addresses saved but provisioning failed: ${error.error || 'Unknown error'}`);
                } else {
                  const result = await provisionResponse.json();
                  const { addresses_saved = 0, buildings_saved = 0, links_created = 0 } = result;
                  console.log(`Stable Linker: ${addresses_saved} addresses, ${buildings_saved} buildings, ${links_created} links`);
                  if (links_created < addresses_saved) {
                    setProvisionProgress(`Linking: ${links_created} / ${addresses_saved} addresses...`);
                  }
                  await new Promise(resolve => setTimeout(resolve, 800));
                }
              } catch (provisionError) {
                console.error('Error provisioning buildings:', provisionError);
                alert('Addresses saved but building provisioning failed. You can provision later.');
              } finally {
                setProvisioning(false);
                setProvisionProgress('');
              }
            } else {
              alert('No addresses found in the drawn polygon. Please try a different area.');
            }
          }
        } catch (addressError) {
          console.error('Error generating addresses:', addressError);
          alert('Campaign created but address generation failed. You can generate addresses later.');
        } finally {
          setGeneratingAddresses(false);
        }
      }

      router.push(`/campaigns/${campaign.id}`);
    } catch (error: any) {
      console.error('Error creating campaign:', error);
      // Extract meaningful error message
      const errorMessage = error?.message || error?.details || error?.hint || 'Unknown error occurred';
      const errorCode = error?.code ? ` (${error.code})` : '';
      alert(`Failed to create campaign: ${errorMessage}${errorCode}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-background overflow-hidden">
      {/* Compact Header Toolbar – matches app header styling */}
      <div className="flex-shrink-0 bg-white dark:bg-card border-b border-border px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Campaign Name */}
          <div className="flex items-center gap-2">
            <Label htmlFor="name" className="text-sm font-medium text-foreground whitespace-nowrap">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Campaign Name"
              className="w-48 bg-gray-200 dark:bg-gray-700"
            />
          </div>

          {/* Campaign Type */}
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium text-foreground whitespace-nowrap">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CampaignType)}>
              <SelectTrigger className={`w-32 bg-gray-200 dark:bg-gray-700 ${type === 'flyer' ? 'text-red-500' : ''}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flyer" className="text-red-500">Flyer</SelectItem>
                <SelectItem value="door_knock">Door Knock</SelectItem>
                <SelectItem value="event">Event</SelectItem>
                <SelectItem value="survey">Survey</SelectItem>
                <SelectItem value="gift">Gift</SelectItem>
                <SelectItem value="pop_by">Pop By</SelectItem>
                <SelectItem value="open_house">Open House</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Address Search */}
          <div className="flex items-center gap-2 flex-1 min-w-64">
            <Label className="text-sm font-medium text-foreground whitespace-nowrap">Search</Label>
            <AddressAutocomplete
              value={mapSearchQuery}
              onChange={setMapSearchQuery}
              onSelect={handleMapSearchSelect}
              placeholder="Jump to address..."
              className="flex-1"
              inputClassName="bg-gray-200 dark:bg-gray-700"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 ml-auto">
            <Button type="button" variant="outline" size="sm" onClick={() => router.back()} disabled={loading || provisioning}>
              Cancel
            </Button>
            <Button 
              type="button" 
              size="sm" 
              disabled={loading || provisioning || generatingAddresses || !name}
              onClick={handleSubmit}
            >
              {loading ? 'Creating...' : generatingAddresses ? 'Finding...' : provisioning ? 'Provisioning...' : 'Create Campaign'}
            </Button>
          </div>
        </div>

        {/* Helper text row */}
        <p className="text-xs text-muted-foreground mt-2">
          Draw a polygon on the map to define your campaign territory. Use the search to jump to a location.
        </p>
        {addressCount !== null && (
          <p className="text-xs font-medium text-green-600 dark:text-green-400 mt-2">
            {addressCount} addresses loaded
          </p>
        )}
      </div>

      {/* Full-screen Map */}
      <div className="flex-1 relative">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        <MapInfoButton show={mapLoaded} />

        {/* Map Controls - Google Maps style floating buttons */}
        {mapLoaded && (
          <div className="absolute top-4 right-4 flex flex-col gap-3 z-10">
            {/* Satellite Toggle */}
            <button
              type="button"
              onClick={toggleSatelliteView}
              className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-lg shadow-lg hover:shadow-xl hover:bg-muted/50 transition-all duration-200 text-sm font-medium text-foreground border border-border"
            >
              {isSatellite ? (
                <>
                  <Map className="w-5 h-5" />
                  <span>Map</span>
                </>
              ) : (
                <>
                  <Satellite className="w-5 h-5" />
                  <span>Satellite</span>
                </>
              )}
            </button>
            
            {/* Draw Button */}
            <button
              type="button"
              onClick={startDrawing}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg shadow-lg hover:shadow-xl hover:bg-red-600 transition-all duration-200 text-sm font-medium border border-red-600"
            >
              <Pencil className="w-5 h-5" />
              <span>Draw</span>
            </button>
            
            {/* Clear Drawing Button */}
            <button
              type="button"
              onClick={clearDrawing}
              className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-lg shadow-lg hover:shadow-xl hover:bg-muted/50 transition-all duration-200 text-sm font-medium text-foreground border border-border"
            >
              <Trash2 className="w-5 h-5" />
              <span>Clear</span>
            </button>
          </div>
        )}

        {/* Draw instructions overlay */}
        {mapLoaded && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-card rounded-full px-5 py-2.5 shadow-lg border border-border z-10">
            <p className="text-sm text-foreground whitespace-nowrap">
              <span className="font-semibold">Click</span> to draw • <span className="font-semibold">Double-click</span> to finish
            </p>
          </div>
        )}
      </div>

      {/* Loading Modal */}
      {(provisioning || generatingAddresses) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card text-card-foreground rounded-lg p-6 max-w-md w-full mx-4 border border-border">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              {generatingAddresses ? 'Finding Nearest Addresses' : 'Provisioning Mission Territory'}
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                <p className="text-sm text-foreground">
                  {generatingAddresses ? 'Querying Overture for nearest addresses...' : (provisionProgress || 'Processing...')}
                </p>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                {generatingAddresses 
                  ? 'Geocoding your starting address and finding nearby residential addresses from Overture data...'
                  : 'Extracting buildings from Overture GERS and calculating road-facing orientation...'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

