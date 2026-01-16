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
import { Satellite, Map } from 'lucide-react';

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

    // Initialize Mapbox Draw
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
      defaultMode: 'draw_polygon',
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

  // Handle map style change
  useEffect(() => {
    if (!map.current || !mapLoaded || !drawRef.current) return;

    const newStyle = isSatellite 
      ? 'mapbox://styles/mapbox/satellite-streets-v12'
      : 'mapbox://styles/mapbox/light-v11';

    // Change map style
    map.current.setStyle(newStyle);

    // Re-add Mapbox Draw control after style loads (controls are removed on style change)
    map.current.once('style.load', () => {
      if (map.current && drawRef.current) {
        map.current.addControl(drawRef.current);
      }
    });
  }, [isSatellite, mapLoaded]);

  const toggleSatelliteView = () => {
    setIsSatellite(!isSatellite);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    // Get drawn polygon if address_source is 'map'
    let polygon: { type: 'Polygon'; coordinates: number[][][] } | null = null;
    if (addressSource === 'map') {
      const features = drawRef.current?.getAll();
      if (!features || features.features.length === 0) {
        alert('Please draw a territory boundary on the map');
        return;
      }
      polygon = features.features[0].geometry as { type: 'Polygon'; coordinates: number[][][] };
    }

    setLoading(true);
    try {
      // Create campaign
      const campaign = await CampaignsService.createV2(userId, {
        name,
        type,
        address_source: addressSource,
        seed_query: addressSource === 'closest_home' ? seedQuery : undefined,
      });

      // Generate address list if "closest_home" or "same_street" source is selected
      if ((addressSource === 'closest_home' || addressSource === 'same_street') && seedQuery) {
        setGeneratingAddresses(true);
        try {
          console.log('Generating address list for:', seedQuery);
          console.log('Selected coordinates:', selectedCoordinates);
          
          // Use selected coordinates if available, otherwise fall back to geocoding the address string
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
              // Small delay to show success message
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        } catch (addressError) {
          console.error('Error generating addresses:', addressError);
          alert('Campaign created but address generation failed. You can generate addresses later.');
        } finally {
          setGeneratingAddresses(false);
        }
      }

      // Provision buildings if territory was drawn
      if (polygon) {
        setProvisioning(true);
        setProvisionProgress('Scanning 3D Shapes...');
        
        try {
          // Simulate progress updates (API doesn't stream, so we estimate)
          const progressInterval = setInterval(() => {
            setProvisionProgress((prev) => {
              if (prev === 'Scanning 3D Shapes...') return 'Matching Addresses...';
              if (prev === 'Matching Addresses...') return 'Calculating Street Facing...';
              if (prev === 'Calculating Street Facing...') return 'Finalizing Mission Territory...';
              return prev;
            });
          }, 2000); // Update every 2 seconds

          const provisionResponse = await fetch('/api/campaigns/provision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaign_id: campaign.id,
              boundary: polygon,
            }),
          });

          clearInterval(progressInterval);
          setProvisionProgress('Finalizing Mission Territory...');

          if (!provisionResponse.ok) {
            const error = await provisionResponse.json();
            console.error('Provisioning error:', error);
            alert(`Campaign created but provisioning failed: ${error.error || 'Unknown error'}`);
          } else {
            const result = await provisionResponse.json();
            console.log(`Provisioned ${result.count} buildings for campaign`);
            // Small delay to show final message
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        } catch (provisionError) {
          console.error('Error provisioning buildings:', provisionError);
          alert('Campaign created but building provisioning failed. You can provision later.');
        } finally {
          setProvisioning(false);
          setProvisionProgress('');
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold">Create Campaign</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-6 space-y-6">
          <div>
            <Label htmlFor="name">Campaign Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Summer Promotion 2025"
            />
          </div>

          <div>
            <Label htmlFor="type">Campaign Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CampaignType)}>
              <SelectTrigger>
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

          <div>
            <Label htmlFor="addressSource">Address Source</Label>
            <Select value={addressSource} onValueChange={(v) => setAddressSource(v as AddressSource)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="map">Map Territory (Recommended)</SelectItem>
                <SelectItem value="closest_home">Closest Home</SelectItem>
                <SelectItem value="import_list">Import List</SelectItem>
                <SelectItem value="same_street">Same Street</SelectItem>
              </SelectContent>
            </Select>
            {addressSource === 'map' && (
              <p className="mt-1 text-sm text-muted-foreground">
                Draw a polygon on the map to define your campaign territory. Buildings will be automatically provisioned from Overture.
              </p>
            )}
          </div>

          {addressSource === 'map' && (
            <div>
              <Label>Territory Boundary</Label>
              <div className="relative">
                <div ref={mapContainer} className="w-full h-96 rounded-md border mt-2" />
                {mapLoaded && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={toggleSatelliteView}
                    className="absolute top-3 right-3 bg-white shadow-md hover:bg-gray-50 z-10"
                  >
                    {isSatellite ? (
                      <>
                        <Map className="w-4 h-4 mr-1" />
                        Map
                      </>
                    ) : (
                      <>
                        <Satellite className="w-4 h-4 mr-1" />
                        Satellite
                      </>
                    )}
                  </Button>
                )}
              </div>
              {mapLoaded && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Click on the map to start drawing. Draw a polygon around your campaign territory.
                </p>
              )}
            </div>
          )}

          {(addressSource === 'closest_home' || addressSource === 'same_street') && (
            <>
              <div>
                <Label htmlFor="seedQuery">Location Query</Label>
                <AddressAutocomplete
                  value={seedQuery}
                  onChange={setSeedQuery}
                  onSelect={(suggestion: AddressSuggestion) => {
                    // Store the selected coordinates
                    setSelectedCoordinates({
                      lat: suggestion.coordinate.latitude,
                      lng: suggestion.coordinate.longitude,
                    });
                    console.log('Selected address:', suggestion);
                    console.log('Coordinates:', {
                      lat: suggestion.coordinate.latitude,
                      lng: suggestion.coordinate.longitude,
                    });
                  }}
                  placeholder="Enter a starting address"
                />
                <p className="mt-1 text-sm text-muted-foreground">
                  {addressSource === 'closest_home'
                    ? "Enter a starting address. We'll find the nearest residential addresses from Overture."
                    : "Enter a starting address. We'll find all addresses on the same street from Overture."}
                </p>
                {addressCount !== null && (
                  <p className="mt-2 text-sm font-medium text-green-600">
                    Addresses loaded: {addressCount}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="numberOfHomes">Number of Homes</Label>
                <Select value={numberOfHomes.toString()} onValueChange={(v) => setNumberOfHomes(parseInt(v))}>
                  <SelectTrigger>
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

          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading || provisioning}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || provisioning || generatingAddresses || !name}>
              {loading ? 'Creating Campaign...' : generatingAddresses ? 'Finding nearest addresses...' : provisioning ? 'Provisioning...' : 'Create Campaign'}
            </Button>
          </div>

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
        </form>
      </main>
    </div>
  );
}

