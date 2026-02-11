'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { 
  Navigation, 
  Clock, 
  Footprints, 
  MapPin, 
  ChevronDown, 
  ChevronUp,
  Route,
  LayoutGrid
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface RouteLayerProps {
  map: mapboxgl.Map;
  campaignId: string | null;
}

interface BlockStop {
  id: string;
  lon: number;
  lat: number;
  address_count: number;
  street_name?: string;
  sequence_in_cluster: number;
}

interface RouteCluster {
  agent_id: number;
  n_addresses: number;
  total_time_min: number;
  total_distance_km: string;
  addresses: Array<{
    id: string;
    sequence: number;
    formatted: string;
    house_number: string;
    street_name: string;
  }>;
  block_stops?: BlockStop[];
}

interface RouteData {
  success: boolean;
  optimized: boolean;
  n_clusters: number;
  clusters: RouteCluster[];
  debug?: {
    block_optimization?: {
      enabled: boolean;
      n_block_stops?: number;
    };
  };
}

const COLORS = [
  '#ef4444', // red-500
  '#f97316', // orange-500
  '#eab308', // yellow-500
  '#22c55e', // green-500
  '#06b6d4', // cyan-500
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#d946ef', // fuchsia-500
];

export function RouteLayer({ map, campaignId }: RouteLayerProps) {
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState(true);
  const [showBlocks, setShowBlocks] = useState(true);
  const [addressCoords, setAddressCoords] = useState<Map<string, { lat: number; lon: number }>>(new Map());
  const routeBoundsFittedRef = useRef(false);

  // Fetch route data
  const fetchRoutes = useCallback(async () => {
    if (!campaignId) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/routes/optimize`, {
        method: 'GET'
      });
      
      if (response.ok) {
        const data = await response.json();
        setRouteData(data);
        
        // If routes exist, fetch address coordinates
        if (data.optimized && data.clusters.length > 0) {
          await fetchAddressCoordinates(campaignId);
        }
      }
    } catch (error) {
      console.error('Error fetching routes:', error);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  // Fetch address coordinates
  const fetchAddressCoordinates = async (campId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('campaign_addresses')
      .select('id, geom')
      .eq('campaign_id', campId);
    
    if (data) {
      const coordMap = new Map();
      data.forEach(addr => {
        if (addr.geom?.coordinates) {
          coordMap.set(addr.id, {
            lon: addr.geom.coordinates[0],
            lat: addr.geom.coordinates[1]
          });
        }
      });
      setAddressCoords(coordMap);
    }
  };

  // Optimize routes
  const optimizeRoutes = async (nAgents: number = 1) => {
    if (!campaignId) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/routes/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          n_agents: nAgents,
          options: {
            street_side_bias: true,
            return_to_depot: true,
            block_optimize: true,
            block_target_size: 50
          }
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setRouteData(data);
        await fetchAddressCoordinates(campaignId);
        setSelectedCluster(0);
      }
    } catch (error) {
      console.error('Error optimizing routes:', error);
    } finally {
      setLoading(false);
    }
  };

  // Draw routes on map
  useEffect(() => {
    if (!map || !routeData?.clusters?.length) return;

    // Remove existing route layers
    ['route-lines', 'route-lines-inter', 'route-points', 'route-labels', 'block-stops', 'block-stop-labels'].forEach(layerId => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    });
    ['route-source', 'route-source-inter', 'route-points-source', 'block-stops-source'].forEach(sourceId => {
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    });

    // Build GeoJSON for all clusters
    const intraBlockFeatures: GeoJSON.Feature[] = [];
    const interBlockFeatures: GeoJSON.Feature[] = [];
    const pointFeatures: GeoJSON.Feature[] = [];
    const blockStopFeatures: GeoJSON.Feature[] = [];

    routeData.clusters.forEach((cluster, idx) => {
      const color = COLORS[idx % COLORS.length];
      const isSelected = selectedCluster === null || selectedCluster === idx;
      const opacity = selectedCluster === null || selectedCluster === idx ? 0.9 : 0.2;
      const hasBlocks = showBlocks && cluster.block_stops && cluster.block_stops.length > 0;

      if (hasBlocks) {
        // BLOCK OPTIMIZED RENDERING
        const sortedBlocks = [...cluster.block_stops!].sort((a, b) => a.sequence_in_cluster - b.sequence_in_cluster);
        
        // Draw inter-block connections (thick lines between block centers)
        const blockCoords: [number, number][] = sortedBlocks.map(b => [b.lon, b.lat]);
        if (blockCoords.length >= 2) {
          interBlockFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: blockCoords
            },
            properties: {
              cluster_id: idx,
              color: color,
              opacity: opacity,
              width: isSelected ? 5 : 3,
              is_inter_block: true
            }
          });
        }

        // Add block stop markers
        sortedBlocks.forEach((block, blockIdx) => {
          blockStopFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [block.lon, block.lat]
            },
            properties: {
              cluster_id: idx,
              block_id: block.id,
              color: color,
              opacity: opacity,
              address_count: block.address_count,
              street_name: block.street_name || '',
              sequence: blockIdx + 1,
              is_block_stop: true
            }
          });
        });

        // Draw intra-block connections (thin lines within each block)
        sortedBlocks.forEach(block => {
          const blockAddresses = cluster.addresses
            .filter(a => {
              // Find addresses that belong to this block
              // Block ID contains address IDs, so we check if any address ID is in the block
              return true; // Simplified - all addresses in sequence
            })
            .sort((a, b) => a.sequence - b.sequence);
          
          const blockAddressCoords: [number, number][] = [];
          blockAddresses.forEach(addr => {
            const coord = addressCoords.get(addr.id);
            if (coord) {
              blockAddressCoords.push([coord.lon, coord.lat]);
              
              // Add point feature
              pointFeatures.push({
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [coord.lon, coord.lat]
                },
                properties: {
                  sequence: addr.sequence,
                  cluster_id: idx,
                  color: color,
                  house_number: addr.house_number,
                  opacity: opacity,
                  is_intra_block: true
                }
              });
            }
          });

          if (blockAddressCoords.length >= 2) {
            intraBlockFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: blockAddressCoords
              },
              properties: {
                cluster_id: idx,
                color: color,
                opacity: opacity * 0.6, // More transparent
                width: isSelected ? 2 : 1,
                is_intra_block: true,
                block_id: block.id
              }
            });
          }
        });
      } else {
        // STANDARD RENDERING (no blocks)
        const coordinates: [number, number][] = [];
        cluster.addresses
          .sort((a, b) => a.sequence - b.sequence)
          .forEach(addr => {
            const coord = addressCoords.get(addr.id);
            if (coord) {
              coordinates.push([coord.lon, coord.lat]);
              
              pointFeatures.push({
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [coord.lon, coord.lat]
                },
                properties: {
                  sequence: addr.sequence,
                  cluster_id: idx,
                  color: color,
                  house_number: addr.house_number,
                  opacity: opacity
                }
              });
            }
          });

        if (coordinates.length >= 2) {
          intraBlockFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates
            },
            properties: {
              cluster_id: idx,
              color: color,
              opacity: opacity,
              width: isSelected ? 4 : 2
            }
          });
        }
      }
    });

    // Add inter-block source and layer (thick lines between blocks)
    if (interBlockFeatures.length > 0) {
      map.addSource('route-source-inter', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: interBlockFeatures
        }
      });

      map.addLayer({
        id: 'route-lines-inter',
        type: 'line',
        source: 'route-source-inter',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity'],
          'line-dasharray': [1, 0] // Solid line
        }
      }, 'route-lines'); // Add before regular route lines
    }

    // Add intra-block source and layer
    if (intraBlockFeatures.length > 0) {
      map.addSource('route-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: intraBlockFeatures
        }
      });

      map.addLayer({
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

    // Add address point markers
    if (pointFeatures.length > 0) {
      map.addSource('route-points-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: pointFeatures
        }
      });

      map.addLayer({
        id: 'route-points',
        type: 'circle',
        source: 'route-points-source',
        paint: {
          'circle-radius': 8,
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      map.addLayer({
        id: 'route-labels',
        type: 'symbol',
        source: 'route-points-source',
        layout: {
          'text-field': ['get', 'sequence'],
          'text-size': 10,
          'text-offset': [0, 0],
          'text-anchor': 'center'
        },
        paint: {
          'text-color': '#ffffff',
          'text-opacity': ['get', 'opacity']
        }
      });
    }

    // Add block stop markers (larger, with count)
    if (blockStopFeatures.length > 0 && showBlocks) {
      map.addSource('block-stops-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: blockStopFeatures
        }
      });

      map.addLayer({
        id: 'block-stops',
        type: 'circle',
        source: 'block-stops-source',
        paint: {
          'circle-radius': 14,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.3,
          'circle-stroke-width': 3,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': ['get', 'opacity']
        }
      });

      map.addLayer({
        id: 'block-stop-labels',
        type: 'symbol',
        source: 'block-stops-source',
        layout: {
          'text-field': ['concat', ['get', 'address_count'], ''],
          'text-size': 11,
          'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 0],
          'text-anchor': 'center'
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-opacity': ['get', 'opacity'],
          'text-halo-color': '#ffffff',
          'text-halo-width': 2
        }
      });
    }

    // Fit map to route bounds once when we have routes and coordinates
    if (!routeBoundsFittedRef.current && routeData.clusters.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      routeData.clusters.forEach((cluster) => {
        // Include block stops in bounds
        if (cluster.block_stops) {
          cluster.block_stops.forEach(block => {
            bounds.extend([block.lon, block.lat]);
          });
        }
        cluster.addresses
          .sort((a, b) => a.sequence - b.sequence)
          .forEach((addr) => {
            const coord = addressCoords.get(addr.id);
            if (coord) bounds.extend([coord.lon, coord.lat]);
          });
      });
      if (!bounds.isEmpty()) {
        routeBoundsFittedRef.current = true;
        map.fitBounds(bounds, { padding: 100, maxZoom: 16, duration: 800 });
      }
    }

    return () => {
      ['route-lines', 'route-lines-inter', 'route-points', 'route-labels', 'block-stops', 'block-stop-labels'].forEach(layerId => {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      });
      ['route-source', 'route-source-inter', 'route-points-source', 'block-stops-source'].forEach(sourceId => {
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      });
    };
  }, [map, routeData, addressCoords, selectedCluster, showBlocks]);

  // Initial fetch and reset fit when campaign changes
  useEffect(() => {
    routeBoundsFittedRef.current = false;
    if (campaignId) {
      fetchRoutes();
    } else {
      setRouteData(null);
    }
  }, [campaignId, fetchRoutes]);

  if (!campaignId) return null;

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const hasBlockOptimization = routeData?.debug?.block_optimization?.enabled;

  return (
    <>
      {/* Route Panel */}
      <div className="absolute top-20 left-4 z-50 w-80">
        <Card className="shadow-lg border-0 bg-white/95 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Route className="w-4 h-4 text-red-500" />
                Walking Routes
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setExpandedPanel(!expandedPanel)}
              >
                {expandedPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </div>
          </CardHeader>
          
          {expandedPanel && (
            <CardContent className="space-y-4">
              {!routeData?.optimized ? (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-500 mb-3">
                    No optimized routes yet.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button
                      size="sm"
                      onClick={() => optimizeRoutes(1)}
                      disabled={loading}
                      className="bg-red-500 hover:bg-red-600"
                    >
                      <Navigation className="w-3 h-3 mr-1" />
                      Optimize route
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Summary */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 rounded p-2">
                      <span className="text-gray-500">Total Time</span>
                      <p className="font-semibold">
                        {formatTime(routeData.clusters.reduce((sum, c) => sum + c.total_time_min, 0))}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <span className="text-gray-500">Addresses</span>
                      <p className="font-semibold">
                        {routeData.clusters.reduce((sum, c) => sum + c.n_addresses, 0)}
                      </p>
                    </div>
                  </div>

                  {/* Block optimization indicator */}
                  {hasBlockOptimization && (
                    <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 p-2 rounded">
                      <LayoutGrid className="w-3 h-3" />
                      <span>
                        Block optimized ({routeData.debug?.block_optimization?.n_block_stops || '?'} blocks)
                      </span>
                    </div>
                  )}

                  {/* Show/Hide blocks toggle */}
                  {hasBlockOptimization && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant={showBlocks ? 'default' : 'outline'}
                        onClick={() => setShowBlocks(!showBlocks)}
                        className="text-xs flex-1"
                      >
                        <LayoutGrid className="w-3 h-3 mr-1" />
                        {showBlocks ? 'Hide Blocks' : 'Show Blocks'}
                      </Button>
                    </div>
                  )}

                  {/* Cluster List */}
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {routeData.clusters.map((cluster, idx) => (
                      <div
                        key={cluster.agent_id}
                        className={`p-2 rounded cursor-pointer transition-all ${
                          selectedCluster === idx 
                            ? 'bg-red-50 border border-red-200' 
                            : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                        onClick={() => setSelectedCluster(selectedCluster === idx ? null : idx)}
                      >
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                          />
                          <span className="font-medium text-sm flex-1">
                            Agent {cluster.agent_id + 1}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {cluster.n_addresses}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTime(cluster.total_time_min)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Footprints className="w-3 h-3" />
                            {cluster.total_distance_km} km
                          </span>
                        </div>

                        {/* Show block stops if available */}
                        {cluster.block_stops && cluster.block_stops.length > 0 && (
                          <div className="mt-1 text-xs text-gray-400">
                            {cluster.block_stops.length} blocks
                          </div>
                        )}

                        {/* Show addresses if selected */}
                        {selectedCluster === idx && (
                          <div className="mt-2 pt-2 border-t border-gray-200">
                            <p className="text-xs font-medium text-gray-500 mb-1">
                              Stops (in order):
                            </p>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {cluster.addresses
                                .sort((a, b) => a.sequence - b.sequence)
                                .map((addr) => (
                                  <div 
                                    key={addr.id}
                                    className="flex items-center gap-2 text-xs"
                                  >
                                    <span className="w-5 h-5 flex items-center justify-center bg-white rounded text-xs font-medium">
                                      {addr.sequence}
                                    </span>
                                    <span className="truncate">
                                      {addr.house_number} {addr.street_name}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="h-px bg-gray-200 my-2" />

                  {/* Re-optimize button */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => optimizeRoutes(1)}
                      disabled={loading}
                      className="flex-1"
                    >
                      <Navigation className="w-3 h-3 mr-1" />
                      Re-optimize
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          )}
        </Card>
      </div>

      {/* Quick agent selector when routes exist */}
      {routeData?.optimized && (
        <div className="absolute top-20 right-4 z-10 flex flex-col gap-1">
          <Button
            size="sm"
            variant={selectedCluster === null ? 'default' : 'outline'}
            onClick={() => setSelectedCluster(null)}
            className={selectedCluster === null ? 'bg-red-500 hover:bg-red-600' : ''}
          >
            All
          </Button>
          {routeData.clusters.map((cluster, idx) => (
            <Button
              key={cluster.agent_id}
              size="sm"
              variant={selectedCluster === idx ? 'default' : 'outline'}
              onClick={() => setSelectedCluster(selectedCluster === idx ? null : idx)}
              className={selectedCluster === idx ? 'bg-red-500 hover:bg-red-600' : ''}
              style={{
                borderColor: selectedCluster === idx ? undefined : COLORS[idx % COLORS.length]
              }}
            >
              Agent {idx + 1}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
