'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CampaignsService } from '@/lib/services/CampaignsService';
import type { CampaignType, AddressSource } from '@/types/database';
import { createClient } from '@/lib/supabase/client';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';
import { Satellite, Map, Trash2, Pencil } from 'lucide-react';
import * as turf from '@turf/turf';

export default function CreateCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [type, setType] = useState<CampaignType>('flyer');
  const [addressSource, setAddressSource] = useState<AddressSource>('map');
  const [seedQuery, setSeedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState<string>('');
  const [generatingAddresses, setGeneratingAddresses] = useState(false);
  const [addressCount, setAddressCount] = useState<number | null>(null);
  const [numberOfHomes, setNumberOfHomes] = useState<number>(50);
  const [userId, setUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);
  const [selectedCoordinates, setSelectedCoordinates] = useState<{ lat: number; lng: number } | null>(null);
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

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
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
            'circle-radius': 7,
            'circle-color': '#ef4444',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
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

    // Determine the correct style based on isSatellite
    const expectedStyle = isSatellite 
      ? 'mapbox://styles/mapbox/satellite-streets-v12'
      : 'mapbox://styles/mapbox/light-v11';

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
          { id: 'gl-draw-polygon-and-line-vertex-active', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 7, 'circle-color': '#ef4444', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } },
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
  }, [isSatellite, mapLoaded]);

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

    // Get drawn polygon if address_source is 'map'
    let polygon: { type: 'Polygon'; coordinates: number[][][] } | null = null;
    let bbox: number[] | undefined = undefined;
    if (addressSource === 'map') {
      const features = drawRef.current?.getAll();
      if (!features || features.features.length === 0) {
        alert('Please draw a territory boundary on the map');
        return;
      }
      polygon = features.features[0].geometry as { type: 'Polygon'; coordinates: number[][][] };
      
      // Calculate bbox from polygon using turf
      try {
        const turfPolygon = turf.polygon(polygon.coordinates);
        const calculatedBbox = turf.bbox(turfPolygon);
        // Convert to array format: [min_lon, min_lat, max_lon, max_lat]
        bbox = [calculatedBbox[0], calculatedBbox[1], calculatedBbox[2], calculatedBbox[3]];
      } catch (bboxError) {
        console.error('Error calculating bbox from polygon:', bboxError);
        // Continue without bbox - it can be calculated later from addresses
      }
    }

    setLoading(true);
    try {
      // Create campaign
      const campaign = await CampaignsService.createV2(userId, {
        name,
        type,
        address_source: addressSource,
        seed_query: addressSource === 'closest_home' ? seedQuery : undefined,
        bbox,
        territory_boundary: polygon || undefined, // Save the drawn polygon for surgical filtering
      });

      // ADDRESS-FIRST LOGIC: Closest Home - Save addresses first, then provision
      if ((addressSource === 'closest_home' || addressSource === 'same_street') && seedQuery) {
        setGeneratingAddresses(true);
        try {
          console.log('Generating address list for:', seedQuery);
          console.log('Selected coordinates:', selectedCoordinates);
          
          // Step 1: Generate addresses
          const addressResponse = await fetch('/api/campaigns/generate-address-list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaign_id: campaign.id,
              starting_address: seedQuery,
              count: numberOfHomes,
              // Pass coordinates if available (API can use them directly instead of geocoding)
              ...(selectedCoordinates && {
                coordinates: {
                  lat: selectedCoordinates.lat,
                  lng: selectedCoordinates.lng,
                },
              }),
            }),
          });

          if (!addressResponse.ok) {
            const error = await addressResponse.json();
            console.error('Address generation error:', error);
            alert(`Campaign created but address generation failed: ${error.error || 'Unknown error'}`);
          } else {
            const result = await addressResponse.json();
            setAddressCount(result.inserted_count || 0);
            console.log(`Generated ${result.inserted_count} addresses for campaign`);
            
            if (result.inserted_count > 0) {
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
                  const provisionResult = await provisionResponse.json();
                  const { addresses_saved = 0, buildings_saved = 0, links_created = 0 } = provisionResult;
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
              alert('No addresses found. Please try a different location.');
            }
          }
        } catch (addressError) {
          console.error('Error generating addresses:', addressError);
          alert('Campaign created but address generation failed. You can generate addresses later.');
        } finally {
          setGeneratingAddresses(false);
        }
      }

      // ADDRESS-FIRST LOGIC: Map Territory - Save addresses first, then provision
      if (polygon && addressSource === 'map') {
        setGeneratingAddresses(true);
        try {
          console.log('Saving addresses from polygon...');
          
          // Step 1: Fetch and save addresses from polygon
          const addressResponse = await fetch('/api/campaigns/generate-address-list', {
            method: 'POST',
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
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Compact Header Toolbar */}
      <div className="flex-shrink-0 bg-white border-b shadow-sm px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Campaign Name */}
          <div className="flex items-center gap-2">
            <Label htmlFor="name" className="text-sm font-medium whitespace-nowrap">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Campaign Name"
              className="w-48"
            />
          </div>

          {/* Campaign Type */}
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium whitespace-nowrap">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CampaignType)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flyer">Flyer</SelectItem>
                <SelectItem value="door_knock">Door Knock</SelectItem>
                <SelectItem value="event">Event</SelectItem>
                <SelectItem value="survey">Survey</SelectItem>
                <SelectItem value="gift">Gift</SelectItem>
                <SelectItem value="pop_by">Pop By</SelectItem>
                <SelectItem value="open_house">Open House</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Address Source */}
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium whitespace-nowrap">Source</Label>
            <Select value={addressSource} onValueChange={(v) => setAddressSource(v as AddressSource)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="map">Map Territory</SelectItem>
                <SelectItem value="closest_home">Closest Home</SelectItem>
                <SelectItem value="import_list">Import List</SelectItem>
                <SelectItem value="same_street">Same Street</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Address Search (for map mode) */}
          {addressSource === 'map' && (
            <div className="flex items-center gap-2 flex-1 min-w-64">
              <Label className="text-sm font-medium whitespace-nowrap">Search</Label>
              <AddressAutocomplete
                value={mapSearchQuery}
                onChange={setMapSearchQuery}
                onSelect={handleMapSearchSelect}
                placeholder="Jump to address..."
                className="flex-1"
              />
            </div>
          )}

          {/* Closest Home / Same Street controls */}
          {(addressSource === 'closest_home' || addressSource === 'same_street') && (
            <>
              <div className="flex items-center gap-2 flex-1 min-w-64">
                <Label className="text-sm font-medium whitespace-nowrap">Start</Label>
                <AddressAutocomplete
                  value={seedQuery}
                  onChange={setSeedQuery}
                  onSelect={(suggestion: AddressSuggestion) => {
                    setSelectedCoordinates({
                      lat: suggestion.coordinate.latitude,
                      lng: suggestion.coordinate.longitude,
                    });
                  }}
                  placeholder="Starting address..."
                  className="flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium whitespace-nowrap">Homes</Label>
                <Select value={numberOfHomes.toString()} onValueChange={(v) => setNumberOfHomes(parseInt(v))}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="250">250</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

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
        {addressSource === 'map' && (
          <p className="text-xs text-muted-foreground mt-2">
            Draw a polygon on the map to define your campaign territory. Use the search to jump to a location.
          </p>
        )}
        {addressCount !== null && (
          <p className="text-xs font-medium text-green-600 mt-2">
            {addressCount} addresses loaded
          </p>
        )}
      </div>

      {/* Full-screen Map */}
      <div className="flex-1 relative">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        
        {/* Map Controls - Google Maps style floating buttons */}
        {mapLoaded && (
          <div className="absolute top-4 right-4 flex flex-col gap-3 z-10">
            {/* Satellite Toggle */}
            <button
              type="button"
              onClick={toggleSatelliteView}
              className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-lg shadow-lg hover:shadow-xl hover:bg-gray-50 transition-all duration-200 text-sm font-medium text-gray-700 border border-gray-200"
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
            {addressSource === 'map' && (
              <button
                type="button"
                onClick={startDrawing}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg shadow-lg hover:shadow-xl hover:bg-red-600 transition-all duration-200 text-sm font-medium border border-red-600"
              >
                <Pencil className="w-5 h-5" />
                <span>Draw</span>
              </button>
            )}
            
            {/* Clear Drawing Button */}
            {addressSource === 'map' && (
              <button
                type="button"
                onClick={clearDrawing}
                className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-lg shadow-lg hover:shadow-xl hover:bg-gray-50 transition-all duration-200 text-sm font-medium text-gray-700 border border-gray-200"
              >
                <Trash2 className="w-5 h-5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        )}

        {/* Draw instructions overlay */}
        {mapLoaded && addressSource === 'map' && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white rounded-full px-5 py-2.5 shadow-lg border border-gray-200 z-10">
            <p className="text-sm text-gray-700 whitespace-nowrap">
              <span className="font-semibold">Click</span> to draw • <span className="font-semibold">Double-click</span> to finish
            </p>
          </div>
        )}
      </div>

      {/* Loading Modal */}
      {(provisioning || generatingAddresses) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {generatingAddresses ? 'Finding Nearest Addresses' : 'Provisioning Mission Territory'}
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                <p className="text-sm">
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

