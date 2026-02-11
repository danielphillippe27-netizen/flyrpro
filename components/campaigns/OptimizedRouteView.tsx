'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from '@/lib/theme-provider';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Navigation, 
  Clock, 
  Footprints, 
  MapPin,
  Route,
  ChevronDown,
  ChevronUp,
  Play,
  RotateCcw
} from 'lucide-react';
import { CampaignsService } from '@/lib/services/CampaignsService';

interface OptimizedRouteViewProps {
  campaignId: string;
  addresses: Array<{
    id: string;
    formatted?: string;
    house_number?: string;
    street_name?: string;
    geom?: { coordinates: [number, number] } | string;
    geom_json?: { coordinates?: [number, number] };
    coordinate?: { lat: number; lon: number };
    cluster_id?: number;
    sequence?: number;
    walk_time_sec?: number;
    distance_m?: number;
  }>;
  onAddressesUpdate?: (addresses: OptimizedRouteViewProps['addresses']) => void;
}

interface RouteCluster {
  agent_id: number;
  n_addresses: number;
  total_time_min: number;
  total_distance_m: number;
  addresses: Array<{
    id: string;
    sequence: number;
    formatted: string;
    house_number: string;
    street_name: string;
    walk_time_sec: number;
    distance_m: number;
    lat: number;
    lon: number;
  }>;
}

const COLORS = [
  '#ef4444', // red-500
  '#f97316', // orange-500  
  '#22c55e', // green-500
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#d946ef', // fuchsia-500
];

const MAP_STYLES = {
  light: 'mapbox://styles/fliper27/cml6z0dhg002301qo9xxc08k4',
  dark: 'mapbox://styles/fliper27/cml6zc5pq002801qo4lh13o19',
} as const;

function isValidCoord(lat: number | undefined, lon: number | undefined): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat !== 0 &&
    lon !== 0 &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/** Get lat/lon from address geom (table or view format) or coordinate fallback */
function getAddressCoords(addr: {
  geom?: { coordinates?: [number, number] } | string;
  geom_json?: { coordinates?: [number, number] };
  coordinate?: { lat: number; lon: number };
}): { lat: number; lon: number } | null {
  // GeoJSON Point: coordinates are [lon, lat]
  const fromCoords = (coords: [number, number] | undefined) => {
    if (!coords || coords.length < 2) return null;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    return isValidCoord(lat, lon) ? { lat, lon } : null;
  };
  const g = addr.geom;
  if (g && typeof g === 'object' && Array.isArray(g.coordinates)) return fromCoords(g.coordinates);
  if (typeof g === 'string') {
    try {
      const parsed = JSON.parse(g) as { coordinates?: [number, number] };
      return fromCoords(parsed?.coordinates);
    } catch {
      // ignore
    }
  }
  if (addr.geom_json?.coordinates) return fromCoords(addr.geom_json.coordinates);
  const c = addr.coordinate;
  if (c && typeof c.lat === 'number' && typeof c.lon === 'number' && isValidCoord(c.lat, c.lon)) {
    return { lat: c.lat, lon: c.lon };
  }
  return null;
}

export function OptimizedRouteView({ campaignId, addresses, onAddressesUpdate }: OptimizedRouteViewProps) {
  const { theme } = useTheme();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [clusters, setClusters] = useState<RouteCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null);
  const [hasRoutes, setHasRoutes] = useState(false);
  /** Single agent only */
  const nAgents = 1;

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || 'pk.eyJ1IjoiZmx5cnBybyIsImEiOiJjbWd6dzZsbm0wYWE3ZWpvbjIwNGVteDV6In0.lvbLszJ7ADa_Cck3A8hZEQ';
    mapboxgl.accessToken = token;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[theme] ?? MAP_STYLES.light,
      center: [-79.3832, 43.6532],
      zoom: 12,
    });

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      map.current?.remove();
    };
  }, [hasRoutes]);

  // Sync map style with app theme (light/dark)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const styleUrl = MAP_STYLES[theme] ?? MAP_STYLES.light;
    try {
      map.current.setStyle(styleUrl);
    } catch (err) {
      console.error('Error setting map style:', err);
    }
  }, [theme, mapLoaded]);

  // Process addresses into clusters
  useEffect(() => {
    if (!addresses?.length) {
      setClusters([]);
      setHasRoutes(false);
      return;
    }

    // Check if any addresses have routes
    const routedAddresses = addresses.filter(a => a.cluster_id !== null && a.cluster_id !== undefined);
    setHasRoutes(routedAddresses.length > 0);

    if (routedAddresses.length === 0) return;

    // Group by cluster
    const clusterMap = new Map<number, RouteCluster>();
    
    routedAddresses.forEach(addr => {
      const clusterId = addr.cluster_id!;
      
      if (!clusterMap.has(clusterId)) {
        clusterMap.set(clusterId, {
          agent_id: clusterId,
          n_addresses: 0,
          total_time_min: 0,
          total_distance_m: 0,
          addresses: []
        });
      }
      
      const coords = getAddressCoords(addr);
      if (!coords) return; // skip addresses with missing/invalid geom
      const cluster = clusterMap.get(clusterId)!;
      cluster.addresses.push({
        id: addr.id,
        sequence: addr.sequence || 0,
        formatted: addr.formatted || '',
        house_number: addr.house_number || '',
        street_name: addr.street_name || '',
        walk_time_sec: addr.walk_time_sec || 0,
        distance_m: addr.distance_m || 0,
        lat: coords.lat,
        lon: coords.lon,
      });
    });

    // Calculate totals and sort
    const clusterArray: RouteCluster[] = [];
    clusterMap.forEach((cluster, id) => {
      cluster.addresses.sort((a, b) => a.sequence - b.sequence);
      cluster.n_addresses = cluster.addresses.length;
      
      const lastAddr = cluster.addresses[cluster.addresses.length - 1];
      cluster.total_time_min = Math.round((lastAddr?.walk_time_sec || 0) / 60);
      cluster.total_distance_m = lastAddr?.distance_m || 0;
      
      clusterArray.push(cluster);
    });

    clusterArray.sort((a, b) => a.agent_id - b.agent_id);
    setClusters(clusterArray);
  }, [addresses]);

  // Fit map to route area when map is ready and we have clusters (ensures we "go to the area")
  useEffect(() => {
    if (!map.current || !mapLoaded || clusters.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    clusters.forEach(cluster => {
      cluster.addresses.forEach(addr => {
        if (isValidCoord(addr.lat, addr.lon)) {
          bounds.extend([addr.lon, addr.lat]);
        }
      });
    });

    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds, {
        padding: 120,
        maxZoom: 16,
        duration: 800,
      });
    }
  }, [mapLoaded, clusters]);

  // Draw routes on map
  useEffect(() => {
    if (!map.current || !mapLoaded || clusters.length === 0) return;

    // Clean up existing layers (including glow)
    ['route-lines-glow', 'route-lines', 'route-points', 'route-labels', 'route-start'].forEach(layerId => {
      if (map.current?.getLayer(layerId)) map.current.removeLayer(layerId);
    });
    ['route-source', 'route-points-source'].forEach(sourceId => {
      if (map.current?.getSource(sourceId)) map.current.removeSource(sourceId);
    });

    const features: GeoJSON.Feature[] = [];
    const pointFeatures: GeoJSON.Feature[] = [];

    clusters.forEach((cluster, idx) => {
      const color = COLORS[idx % COLORS.length];
      const isSelected = selectedCluster === null || selectedCluster === idx;
      const opacity = isSelected ? 1 : 0.35;

      // Create line from valid coordinates only (avoid 0,0 or invalid points)
      const coordinates: [number, number][] = cluster.addresses
        .filter(a => isValidCoord(a.lat, a.lon))
        .map(a => [a.lon, a.lat]);
      
      if (coordinates.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates
          },
          properties: {
            cluster_id: idx,
            color: color,
            opacity: opacity,
            width: isSelected ? 6 : 2.5
          }
        });
      }

      // Show sequence labels only when route has few stops (readable map)
      const showLabels = cluster.addresses.length <= 30;

      // Create points
      cluster.addresses.forEach((addr, addrIdx) => {
        pointFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [addr.lon, addr.lat]
          },
          properties: {
            sequence: addr.sequence,
            label_text: showLabels ? String(addr.sequence) : '',
            cluster_id: idx,
            color: color,
            opacity: opacity,
            is_start: addrIdx === 0
          }
        });
      });
    });

    // Add sources and layers
    if (features.length > 0) {
      map.current.addSource('route-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features }
      });

      // Glow layer (wider, semi-transparent) so route stands out on the map
      map.current.addLayer({
        id: 'route-lines-glow',
        type: 'line',
        source: 'route-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['+', ['get', 'width'], 8],
          'line-opacity': ['*', ['get', 'opacity'], 0.25]
        }
      });

      map.current.addLayer({
        id: 'route-lines',
        type: 'line',
        source: 'route-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity']
        }
      });
    }

    if (pointFeatures.length > 0) {
      map.current.addSource('route-points-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: pointFeatures }
      });

      // Regular stops
      map.current.addLayer({
        id: 'route-points',
        type: 'circle',
        source: 'route-points-source',
        paint: {
          'circle-radius': ['case', ['get', 'is_start'], 12, 8],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      // Labels (only for clusters with ≤30 stops to avoid clutter)
      map.current.addLayer({
        id: 'route-labels',
        type: 'symbol',
        source: 'route-points-source',
        layout: {
          'text-field': ['get', 'label_text'],
          'text-size': 10,
          'text-anchor': 'center',
          'text-offset': [0, 0]
        },
        paint: {
          'text-color': '#ffffff',
          'text-opacity': ['get', 'opacity']
        }
      });
    }
  }, [clusters, mapLoaded, selectedCluster]);

  const optimizeRoutes = async (nAgents: number = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/routes/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          n_agents: nAgents,
          options: {
            street_side_bias: true,
            return_to_depot: true
          }
        }),
      });

      const text = await res.text();
      let data: { error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        // Server returned non-JSON (e.g. "Internal Server Error" plain text)
        throw new Error(res.ok ? 'Invalid response' : text || `Request failed (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(data.error || 'Optimization failed');
      }

      // Refresh addresses from same source as page load (campaign_addresses_geojson)
      // so cluster_id/sequence and geom are in the expected shape for the map.
      const freshAddresses = await CampaignsService.fetchAddresses(campaignId);
      if (freshAddresses?.length && onAddressesUpdate) {
        onAddressesUpdate(freshAddresses);
      }
    } catch (error) {
      console.error('Error:', error);
      alert(error instanceof Error ? error.message : 'Failed to optimize');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const formatDistance = (meters: number) => {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const fitMapToRoute = useCallback(() => {
    if (!map.current || clusters.length === 0) return;
    const bounds = new mapboxgl.LngLatBounds();
    clusters.forEach(cluster => {
      cluster.addresses.forEach(addr => {
        if (isValidCoord(addr.lat, addr.lon)) bounds.extend([addr.lon, addr.lat]);
      });
    });
    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds, { padding: 120, maxZoom: 16, duration: 800 });
    }
  }, [clusters]);

  if (!hasRoutes) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-center py-8">
              <Route className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No optimized routes yet</h3>
              <p className="text-sm text-gray-500 mb-4">
                Generate an optimized walking route. Route minimizes walking distance.
              </p>
              <Button 
                onClick={() => optimizeRoutes(nAgents)} 
                disabled={loading || addresses.length < 2}
                className="w-full"
              >
                <Navigation className="w-4 h-4 mr-2" />
                {loading ? 'Optimizing...' : 'Optimize route'}
              </Button>
              {addresses.length < 2 && (
                <p className="text-xs text-gray-400 mt-2">
                  Need at least 2 addresses to optimize
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-500">Stops</span>
            </div>
            <p className="text-2xl font-bold">
              {clusters.reduce((sum, c) => sum + c.n_addresses, 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-500">Total Time</span>
            </div>
            <p className="text-2xl font-bold">
              {formatTime(clusters.reduce((sum, c) => sum + c.total_time_min, 0))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Footprints className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-500">Distance</span>
            </div>
            <p className="text-2xl font-bold">
              {formatDistance(clusters.reduce((sum, c) => sum + c.total_distance_m, 0))}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Map */}
      <div className="relative h-[600px] w-full rounded-lg border bg-card shadow-sm">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full rounded-lg" />
        <MapInfoButton show={mapLoaded} />
      </div>

      {/* Agent List */}
      <div className="space-y-2 mt-4">
        <div className="flex gap-2 mb-2">
          <Button 
            variant={selectedCluster === null ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setSelectedCluster(null)}
            className="flex-1"
          >
            All Routes
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fitMapToRoute}
            title="Center map on route"
          >
            <MapPin className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => optimizeRoutes(1)}
            disabled={loading}
            title="Re-optimize route"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clusters.map((cluster, idx) => (
            <Card 
              key={cluster.agent_id}
              className={`cursor-pointer transition-all ${
                selectedCluster === idx ? 'ring-2 ring-red-500' : ''
              }`}
              onClick={() => setSelectedCluster(selectedCluster === idx ? null : idx)}
            >
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                    />
                    <CardTitle className="text-sm">Agent {idx + 1}</CardTitle>
                  </div>
                  <Badge variant="secondary">{cluster.n_addresses}</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTime(cluster.total_time_min)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Footprints className="w-3 h-3" />
                    {formatDistance(cluster.total_distance_m)}
                  </span>
                </div>

                {expandedAgent === idx && (
                  <div className="mt-3 pt-3 border-t space-y-1">
                    <p className="text-xs font-medium text-gray-500 mb-2">Stops:</p>
                    {cluster.addresses.map((addr) => (
                      <div 
                        key={addr.id}
                        className="flex items-center gap-2 text-xs py-1"
                      >
                        <span className="w-5 h-5 flex items-center justify-center bg-gray-100 rounded text-xs font-medium">
                          {addr.sequence}
                        </span>
                        <span className="truncate">
                          {addr.house_number} {addr.street_name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedAgent(expandedAgent === idx ? null : idx);
                  }}
                >
                  {expandedAgent === idx ? (
                    <><ChevronUp className="w-3 h-3 mr-1" /> Hide stops</>
                  ) : (
                    <><ChevronDown className="w-3 h-3 mr-1" /> Show stops</>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
