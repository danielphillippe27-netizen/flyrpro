'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Compass,
  Eraser,
  Expand,
  Film,
  Loader2,
  MapPinned,
  Maximize2,
  Palette,
  Pencil,
  PenLine,
  Play,
  RotateCcw,
  RotateCw,
  Send,
  Shuffle,
  Sparkles,
  Square,
  Users,
  X,
} from 'lucide-react';
import type { CampaignAddress } from '@/types/database';
import { MapBuildingsLayer, type MapBuildingsRenderState } from '@/components/map/MapBuildingsLayer';
import { useWorkspace } from '@/lib/workspace-context';
import { useMovieMapControlsEnabled } from '@/lib/hooks/useMovieMapControlsEnabled';
import { useTheme } from '@/lib/theme-provider';
import { useMapStyle } from '@/lib/map-style-provider';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import { applyPresetVisualTweaks, getResolvedMapInitOptions, resolveMapStyle } from '@/lib/map-styles';
import {
  type CampaignAssignmentMode,
  type CampaignAssignmentSplitMode,
} from '@/lib/campaignAssignments';
import {
  applyManualOverridesToZones,
  buildAssignmentByAddressId,
  countManualOverridesByMember,
  sanitizeManualOverrides,
  shallowRecordEqual,
} from '@/lib/campaignAssignmentDraft';
import { selectedAddressIdsFromDraw } from '@/lib/campaignAssignmentMapSelection';
import {
  buildBalancedBlockClusters,
  buildSmartTerritoryClusters,
  buildNaturalZoneClusters,
  type BuildRouteAddress,
} from '@/lib/services/BlockRoutingService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type TeamMember = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member';
};

type AssignmentRow = {
  id: string;
  assigned_to_user_id: string;
  mode: CampaignAssignmentMode;
  goal_homes: number;
  zone_index: number | null;
  due_at: string | null;
  notes: string | null;
  assignee?: {
    display_name: string;
  };
  homes?: Array<{ campaign_address_id: string; sequence: number }>;
};

type CampaignAssignmentViewProps = {
  campaignId: string;
  campaignName?: string;
  addresses: CampaignAddress[];
};

type AssignmentAddress = BuildRouteAddress & {
  sequence: number;
};

const COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#8b5cf6', '#d946ef', '#f97316'];
const DEMO_GREEN_COLOR = '#22c55e';
const DEMO_RANDOM_COLORS = ['#22c55e', '#3b82f6', '#ef4444', '#8b5cf6', '#f97316', '#06b6d4', '#eab308'];
const DEMO_CAMERA_PITCH_STREET_DEGREES = 68;
const DEMO_CAMERA_PITCH_3D_DEGREES = 62;
const DEMO_CAMERA_ZOOM_STREET = 18.15;

type ZonePreviewMember = {
  user_id: string;
  display_name: string;
  color: string;
};

type ZonePreviewPoint = {
  lon: number;
  lat: number;
};

type DemoColorMode = 'zones' | 'allGreen' | 'random';
type DemoCameraShot =
  | 'orbit'
  | 'birdToStreet'
  | 'flyThrough'
  | 'streetSweep'
  | 'birdFlyThrough'
  | 'craneReveal'
  | 'angledPullback'
  | 'slideLeft'
  | 'streetSegments';
type DemoCameraSpeed = 'normal' | 'superSlow';
type DemoSegmentCameraAngle = 'fixed' | 'bird' | 'threeD' | 'street';
type DemoFitCameraOptions = {
  pitch: number;
  bearing: number;
  maxZoom: number;
  duration: number;
};
type DemoAddressTarget = {
  addressId: string;
  lon: number;
  lat: number;
  streetKey: string;
  streetLabel: string;
  houseNumber: number | null;
};

function deterministicColorIndex(seed: string, paletteLength: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % paletteLength;
}

function easeInOutCubic(progress: number): number {
  return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function bearingBetween(start: [number, number], end: [number, number]): number {
  const startLat = (start[1] * Math.PI) / 180;
  const startLon = (start[0] * Math.PI) / 180;
  const endLat = (end[1] * Math.PI) / 180;
  const endLon = (end[0] * Math.PI) / 180;
  const deltaLon = endLon - startLon;
  const y = Math.sin(deltaLon) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function demoSweepEndpoints(bounds: mapboxgl.LngLatBounds): {
  start: [number, number];
  middle: [number, number];
  end: [number, number];
  bearing: number;
} {
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const center = bounds.getCenter();
  const lonSpan = Math.abs(east - west);
  const latSpan = Math.abs(north - south);
  const start: [number, number] = lonSpan >= latSpan ? [west, center.lat] : [center.lng, south];
  const end: [number, number] = lonSpan >= latSpan ? [east, center.lat] : [center.lng, north];
  const middle: [number, number] = [center.lng, center.lat];

  return {
    start,
    middle,
    end,
    bearing: bearingBetween(start, end),
  };
}

function demoStreetLabel(address: AssignmentAddress): string {
  const streetName = String(address.street_name ?? '').trim();
  if (streetName) return streetName;

  const formatted = String(address.formatted ?? '').trim();
  const withoutLeadingNumber = formatted.replace(/^\s*\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?\s+/, '').trim();
  const beforeComma = withoutLeadingNumber.split(',')[0]?.trim();
  return beforeComma || 'Assignment route';
}

function demoHouseNumber(address: AssignmentAddress): number | null {
  const direct = String(address.house_number ?? '').trim();
  const source = direct || String(address.formatted ?? '').trim();
  const match = source.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function getAddressCoords(address: CampaignAddress): { lat: number; lon: number } | null {
  const coordinate = address.coordinate;
  if (coordinate && typeof coordinate.lat === 'number' && typeof coordinate.lon === 'number') {
    return { lat: coordinate.lat, lon: coordinate.lon };
  }

  const geomJson = address as CampaignAddress & { geom_json?: { coordinates?: [number, number] } };
  if (geomJson.geom_json?.coordinates) {
    const [lon, lat] = geomJson.geom_json.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }

  if (typeof address.geom === 'string' && address.geom.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(address.geom) as { coordinates?: [number, number] };
      const coordinates = parsed.coordinates;
      if (!coordinates) return null;
      const [lon, lat] = coordinates;
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    } catch {
      return null;
    }
  }

  return null;
}

function toAssignmentAddresses(addresses: CampaignAddress[]): AssignmentAddress[] {
  return addresses
    .map((address, index) => {
      const coords = getAddressCoords(address);
      return {
        id: address.id,
        lat: coords?.lat ?? 0,
        lon: coords?.lon ?? 0,
        house_number: address.house_number,
        street_name: address.street_name,
        formatted: address.formatted ?? address.address,
        sequence: address.sequence ?? address.seq ?? index,
      };
    })
    .sort((left, right) => left.sequence - right.sequence);
}

function contiguousSplit(addresses: AssignmentAddress[], bins: number): AssignmentAddress[][] {
  if (bins <= 1) return [addresses];
  const chunks: AssignmentAddress[][] = [];
  const total = addresses.length;
  let cursor = 0;

  for (let index = 0; index < bins; index += 1) {
    const remainingBins = bins - index;
    const remainingHomes = total - cursor;
    const size = Math.ceil(remainingHomes / remainingBins);
    chunks.push(addresses.slice(cursor, cursor + size));
    cursor += size;
  }

  return chunks;
}

function buildZones(
  addresses: AssignmentAddress[],
  memberIds: string[],
  splitMode: CampaignAssignmentSplitMode
): Map<string, AssignmentAddress[]> {
  const zones = new Map<string, AssignmentAddress[]>();
  if (memberIds.length === 0) return zones;

  if (memberIds.length > addresses.length) {
    memberIds.forEach((memberId) => zones.set(memberId, []));
    return zones;
  }

  const depot = addresses.reduce(
    (sum, address) => ({
      lat: sum.lat + address.lat / addresses.length,
      lon: sum.lon + address.lon / addresses.length,
    }),
    { lat: 0, lon: 0 }
  );
  const clusters = splitMode === 'balanced'
    ? buildBalancedBlockClusters(addresses, memberIds.length, depot)
    : splitMode === 'smart'
      ? buildSmartTerritoryClusters(addresses, memberIds.length, depot)
      : buildNaturalZoneClusters(addresses, memberIds.length, depot);
  const chunks =
    clusters.length === memberIds.length
      ? clusters.map((cluster) =>
          cluster.addresses.map((address) => ({
            ...address,
            sequence: addresses.find((candidate) => candidate.id === address.id)?.sequence ?? address.sequence_index,
          }))
        )
      : contiguousSplit(addresses, memberIds.length);

  memberIds.forEach((memberId, index) => {
    zones.set(memberId, chunks[index] ?? []);
  });
  return zones;
}

function formatMode(mode: CampaignAssignmentMode): string {
  return mode === 'zone_split' ? 'Zone split' : 'Whole team';
}

function syncMapSize(map: mapboxgl.Map) {
  try {
    map.resize();
  } catch {
    // Ignore transient resize errors while the dialog is opening or closing.
  }
}

function enableFreeMapCamera(map: mapboxgl.Map) {
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();
}

function hasRenderableMapStyle(map: mapboxgl.Map) {
  try {
    if (map.loaded() || map.isStyleLoaded()) return true;
  } catch {
    // Fall through to style inspection.
  }

  try {
    return Boolean(map.getStyle()?.layers?.length);
  } catch {
    return false;
  }
}

function useAssignmentDemoCamera({
  mapRef,
  mapLoaded,
  assignmentAddresses,
  previewPoints,
  baseColorByAddressId,
  enabled,
}: {
  mapRef: RefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
  assignmentAddresses: AssignmentAddress[];
  previewPoints: ZonePreviewPoint[];
  baseColorByAddressId?: Record<string, string>;
  enabled: boolean;
}) {
  const [demoColorMode, setDemoColorMode] = useState<DemoColorMode>('zones');
  const [demoCameraSpeed, setDemoCameraSpeed] = useState<DemoCameraSpeed>('normal');
  const [demoSegmentCameraAngle, setDemoSegmentCameraAngle] = useState<DemoSegmentCameraAngle>('fixed');
  const [showDemoControls, setShowDemoControls] = useState(false);
  const [activeDemoCameraShot, setActiveDemoCameraShot] = useState<DemoCameraShot | null>(null);
  const [demoPlaybackColorOverrides, setDemoPlaybackColorOverrides] = useState<Record<string, string> | null>(null);
  const demoCameraTimeoutsRef = useRef<number[]>([]);
  const demoCameraFrameRef = useRef<number | null>(null);

  const getAssignmentMapBounds = useCallback((): mapboxgl.LngLatBounds | null => {
    const bounds = new mapboxgl.LngLatBounds();
    for (const point of previewPoints) {
      if (Number.isFinite(point.lon) && Number.isFinite(point.lat)) {
        bounds.extend([point.lon, point.lat]);
      }
    }
    return bounds.isEmpty() ? null : bounds;
  }, [previewPoints]);

  const demoAddressTargets = useMemo<DemoAddressTarget[]>(
    () =>
      assignmentAddresses
        .flatMap((address) => {
          if (!Number.isFinite(address.lon) || !Number.isFinite(address.lat)) return [];
          if (address.lon === 0 && address.lat === 0) return [];
          const streetLabel = demoStreetLabel(address);

          return [{
            addressId: address.id,
            lon: address.lon,
            lat: address.lat,
            streetKey: streetLabel.toLowerCase(),
            streetLabel,
            houseNumber: demoHouseNumber(address),
          }];
        })
        .sort((lhs, rhs) => {
          if (lhs.streetKey !== rhs.streetKey) return lhs.streetKey.localeCompare(rhs.streetKey);
          if (lhs.houseNumber !== null && rhs.houseNumber !== null && lhs.houseNumber !== rhs.houseNumber) {
            return lhs.houseNumber - rhs.houseNumber;
          }
          if (lhs.lat !== rhs.lat) return lhs.lat - rhs.lat;
          return lhs.lon - rhs.lon;
        }),
    [assignmentAddresses]
  );

  const demoColorByAddressId = useMemo(() => {
    if (!enabled) return baseColorByAddressId;
    if (demoPlaybackColorOverrides) return demoPlaybackColorOverrides;
    if (demoColorMode === 'zones') return baseColorByAddressId;

    const colors: Record<string, string> = {};
    for (const address of assignmentAddresses) {
      if (!address.id) continue;
      colors[address.id] =
        demoColorMode === 'allGreen'
          ? DEMO_GREEN_COLOR
          : DEMO_RANDOM_COLORS[deterministicColorIndex(address.id, DEMO_RANDOM_COLORS.length)];
    }
    return colors;
  }, [assignmentAddresses, baseColorByAddressId, demoColorMode, demoPlaybackColorOverrides, enabled]);

  const clearDemoCameraTimers = useCallback(() => {
    for (const timeoutId of demoCameraTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    demoCameraTimeoutsRef.current = [];
    if (demoCameraFrameRef.current !== null) {
      window.cancelAnimationFrame(demoCameraFrameRef.current);
      demoCameraFrameRef.current = null;
    }
  }, []);

  const stopDemoCamera = useCallback(() => {
    clearDemoCameraTimers();
    mapRef.current?.stop();
    setActiveDemoCameraShot(null);
    setDemoPlaybackColorOverrides(null);
  }, [clearDemoCameraTimers, mapRef]);

  const playDemoCamera = useCallback(
    (shot: DemoCameraShot) => {
      const currentMap = mapRef.current;
      if (!enabled || !currentMap || !mapLoaded) return;

      const bounds = getAssignmentMapBounds();
      const center = bounds?.getCenter() ?? currentMap.getCenter();
      const centerTuple: [number, number] = [center.lng, center.lat];
      const sweep = bounds ? demoSweepEndpoints(bounds) : null;
      const fallbackZoom = Math.max(15, Math.min(17.2, currentMap.getZoom() || 15));
      const speedMultiplier = demoCameraSpeed === 'superSlow' ? 2.6 : 1;
      const speed = (milliseconds: number) => Math.round(milliseconds * speedMultiplier);

      clearDemoCameraTimers();
      currentMap.stop();
      currentMap.resize();
      setDemoPlaybackColorOverrides(null);
      setShowDemoControls(true);
      setActiveDemoCameraShot(shot);

      const schedule = (callback: () => void, delay: number) => {
        const timeoutId = window.setTimeout(callback, speed(delay));
        demoCameraTimeoutsRef.current.push(timeoutId);
      };

      const finishAfter = (delay: number) => {
        schedule(() => setActiveDemoCameraShot(null), delay);
      };

      const fitAssignment = (options: DemoFitCameraOptions) => {
        if (bounds) {
          currentMap.fitBounds(bounds, {
            padding: { top: 72, right: 72, bottom: 96, left: 72 },
            ...options,
          });
          return;
        }
        currentMap.easeTo({
          center: centerTuple,
          zoom: fallbackZoom,
          pitch: options.pitch,
          bearing: options.bearing,
          duration: options.duration,
          easing: easeInOutCubic,
        });
      };

      if (shot === 'orbit') {
        fitAssignment({
          maxZoom: 16,
          duration: speed(900),
          pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
          bearing: -35,
        });
        schedule(() => {
          const startAt = performance.now();
          const startBearing = currentMap.getBearing();
          const orbitZoom = Math.max(15.4, Math.min(17, currentMap.getZoom() + 0.45));
          const duration = speed(11000);

          const step = (now: number) => {
            const progress = Math.min(1, (now - startAt) / duration);
            currentMap.jumpTo({
              center: centerTuple,
              zoom: orbitZoom,
              pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
              bearing: startBearing + progress * 360,
            });

            if (progress < 1) {
              demoCameraFrameRef.current = window.requestAnimationFrame(step);
            } else {
              demoCameraFrameRef.current = null;
              setActiveDemoCameraShot(null);
            }
          };

          demoCameraFrameRef.current = window.requestAnimationFrame(step);
        }, 980);
        return;
      }

      if (shot === 'birdToStreet') {
        fitAssignment({
          maxZoom: 15.2,
          duration: speed(900),
          pitch: 0,
          bearing: 0,
        });
        schedule(() => {
          currentMap.flyTo({
            center: centerTuple,
            zoom: DEMO_CAMERA_ZOOM_STREET,
            pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
            bearing: sweep?.bearing ?? 35,
            duration: speed(4200),
            essential: true,
          });
        }, 1050);
        finishAfter(5400);
        return;
      }

      if (shot === 'birdFlyThrough') {
        const start = sweep?.start ?? centerTuple;
        const middle = sweep?.middle ?? centerTuple;
        const end = sweep?.end ?? centerTuple;
        const bearing = sweep?.bearing ?? 0;
        currentMap.flyTo({
          center: start,
          zoom: Math.max(17.1, fallbackZoom + 0.9),
          pitch: 0,
          bearing,
          duration: speed(1050),
          essential: true,
        });
        schedule(() => {
          currentMap.easeTo({
            center: middle,
            zoom: DEMO_CAMERA_ZOOM_STREET,
            pitch: 0,
            bearing,
            duration: speed(3000),
            easing: easeInOutCubic,
          });
        }, 1080);
        schedule(() => {
          currentMap.easeTo({
            center: end,
            zoom: DEMO_CAMERA_ZOOM_STREET,
            pitch: 0,
            bearing,
            duration: speed(3300),
            easing: easeInOutCubic,
          });
        }, 4150);
        finishAfter(7600);
        return;
      }

      if (shot === 'craneReveal') {
        const bearing = sweep?.bearing ?? -25;
        currentMap.flyTo({
          center: centerTuple,
          zoom: DEMO_CAMERA_ZOOM_STREET,
          pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
          bearing,
          duration: speed(1100),
          essential: true,
        });
        schedule(() => {
          fitAssignment({
            maxZoom: 15.3,
            duration: speed(5200),
            pitch: 0,
            bearing: bearing + 42,
          });
        }, 1150);
        finishAfter(6600);
        return;
      }

      if (shot === 'angledPullback') {
        const currentCenter = currentMap.getCenter();
        const startCenter: [number, number] = [currentCenter.lng, currentCenter.lat];
        const startZoom = currentMap.getZoom();
        const startPitch = currentMap.getPitch();
        const startBearing = currentMap.getBearing();
        const duration = speed(5600);
        const targetPitch = startPitch > 45 ? 45 : startPitch;
        const startAt = performance.now();

        const step = (now: number) => {
          const progress = Math.min(1, (now - startAt) / duration);
          const eased = easeInOutCubic(progress);

          currentMap.jumpTo({
            center: startCenter,
            zoom: Math.max(13.4, startZoom - 1.85 * eased),
            pitch: startPitch + (targetPitch - startPitch) * eased,
            bearing: startBearing,
          });

          if (progress < 1) {
            demoCameraFrameRef.current = window.requestAnimationFrame(step);
          } else {
            demoCameraFrameRef.current = null;
            setActiveDemoCameraShot(null);
          }
        };

        demoCameraFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      if (shot === 'slideLeft') {
        const startCenter = currentMap.getCenter();
        const startCenterTuple: [number, number] = [startCenter.lng, startCenter.lat];
        const startPoint = currentMap.project(startCenter);
        const canvas = currentMap.getCanvas();
        const endCenter = currentMap.unproject([
          startPoint.x - Math.max(360, canvas.clientWidth * 0.62),
          startPoint.y,
        ]);
        const endCenterTuple: [number, number] = [endCenter.lng, endCenter.lat];
        const zoom = currentMap.getZoom();
        const pitch = currentMap.getPitch();
        const bearing = currentMap.getBearing();
        const duration = speed(5200);
        const startAt = performance.now();

        const step = (now: number) => {
          const progress = Math.min(1, (now - startAt) / duration);
          const eased = easeInOutCubic(progress);

          currentMap.jumpTo({
            center: [
              startCenterTuple[0] + (endCenterTuple[0] - startCenterTuple[0]) * eased,
              startCenterTuple[1] + (endCenterTuple[1] - startCenterTuple[1]) * eased,
            ],
            zoom,
            pitch,
            bearing,
          });

          if (progress < 1) {
            demoCameraFrameRef.current = window.requestAnimationFrame(step);
          } else {
            demoCameraFrameRef.current = null;
            setActiveDemoCameraShot(null);
          }
        };

        demoCameraFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      if (shot === 'streetSegments') {
        const segmentCamera =
          demoSegmentCameraAngle === 'fixed'
            ? null
            : {
                bird: {
                  maxZoom: 16.8,
                  pitch: 0,
                  bearing: 0,
                },
                threeD: {
                  maxZoom: 16.2,
                  pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
                  bearing: sweep?.bearing ?? -12,
                },
                street: {
                  maxZoom: 17.4,
                  pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
                  bearing: sweep?.bearing ?? 35,
                },
              }[demoSegmentCameraAngle];

        if (segmentCamera) {
          fitAssignment({
            ...segmentCamera,
            duration: speed(900),
          });
        }
        setDemoPlaybackColorOverrides({});

        const litColors: Record<string, string> = {};
        let delay = 1050;
        let previousStreetKey: string | null = null;
        demoAddressTargets.forEach((target, index) => {
          if (previousStreetKey && previousStreetKey !== target.streetKey) {
            delay += 420;
          }
          previousStreetKey = target.streetKey;

          schedule(() => {
            litColors[target.addressId] =
              demoColorMode === 'random'
                ? DEMO_RANDOM_COLORS[deterministicColorIndex(target.addressId, DEMO_RANDOM_COLORS.length)]
                : DEMO_GREEN_COLOR;
            setDemoPlaybackColorOverrides({ ...litColors });
          }, delay);
          delay += index < 35 ? 110 : 70;
        });

        finishAfter(Math.max(1800, delay + 500));
        return;
      }

      if (shot === 'flyThrough') {
        const start = sweep?.start ?? centerTuple;
        const middle = sweep?.middle ?? centerTuple;
        const end = sweep?.end ?? centerTuple;
        const bearing = sweep?.bearing ?? currentMap.getBearing();
        currentMap.flyTo({
          center: start,
          zoom: Math.max(16, fallbackZoom),
          pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
          bearing,
          duration: speed(1200),
          essential: true,
        });
        schedule(() => {
          currentMap.easeTo({
            center: middle,
            zoom: Math.max(17, fallbackZoom + 0.6),
            pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
            bearing,
            duration: speed(3600),
            easing: easeInOutCubic,
          });
        }, 1250);
        schedule(() => {
          currentMap.easeTo({
            center: end,
            zoom: Math.max(17, fallbackZoom + 0.6),
            pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
            bearing,
            duration: speed(3600),
            easing: easeInOutCubic,
          });
        }, 4900);
        finishAfter(8700);
        return;
      }

      const start = sweep?.start ?? centerTuple;
      const end = sweep?.end ?? centerTuple;
      const bearing = sweep?.bearing ?? 35;
      currentMap.flyTo({
        center: start,
        zoom: DEMO_CAMERA_ZOOM_STREET,
        pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
        bearing,
        duration: speed(1000),
        essential: true,
      });
      schedule(() => {
        currentMap.easeTo({
          center: end,
          zoom: DEMO_CAMERA_ZOOM_STREET,
          pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
          bearing,
          duration: speed(6200),
          easing: easeInOutCubic,
        });
      }, 1100);
      finishAfter(7600);
    },
    [
      clearDemoCameraTimers,
      demoAddressTargets,
      demoCameraSpeed,
      demoColorMode,
      demoSegmentCameraAngle,
      enabled,
      getAssignmentMapBounds,
      mapLoaded,
      mapRef,
    ]
  );

  useEffect(() => {
    if (enabled) return;
    setShowDemoControls(false);
    setDemoColorMode('zones');
    stopDemoCamera();
  }, [enabled, stopDemoCamera]);

  useEffect(() => {
    const currentMap = mapRef.current;
    return () => {
      clearDemoCameraTimers();
      currentMap?.stop();
    };
  }, [clearDemoCameraTimers, mapRef]);

  const handleDemoColorModeChange = useCallback((mode: DemoColorMode) => {
    setDemoPlaybackColorOverrides(null);
    setDemoColorMode(mode);
  }, []);

  return {
    activeDemoCameraShot,
    demoCameraSpeed,
    demoColorByAddressId,
    demoColorMode,
    demoSegmentCameraAngle,
    handleDemoColorModeChange,
    playDemoCamera,
    setDemoCameraSpeed,
    setDemoSegmentCameraAngle,
    setShowDemoControls,
    showDemoControls,
    stopDemoCamera,
  };
}

function AssignmentDemoCameraControls({
  activeDemoCameraShot,
  demoCameraSpeed,
  demoColorMode,
  demoSegmentCameraAngle,
  disabled,
  enabled,
  onColorModeChange,
  onPlayShot,
  onSegmentCameraAngleChange,
  onSpeedChange,
  onStop,
  setShowDemoControls,
  showDemoControls,
}: {
  activeDemoCameraShot: DemoCameraShot | null;
  demoCameraSpeed: DemoCameraSpeed;
  demoColorMode: DemoColorMode;
  demoSegmentCameraAngle: DemoSegmentCameraAngle;
  disabled?: boolean;
  enabled: boolean;
  onColorModeChange: (mode: DemoColorMode) => void;
  onPlayShot: (shot: DemoCameraShot) => void;
  onSegmentCameraAngleChange: (angle: DemoSegmentCameraAngle) => void;
  onSpeedChange: (speed: DemoCameraSpeed) => void;
  onStop: () => void;
  setShowDemoControls: (value: boolean | ((current: boolean) => boolean)) => void;
  showDemoControls: boolean;
}) {
  if (!enabled) return null;

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setShowDemoControls((current) => !current)}
        disabled={disabled}
        className={`pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white/92 text-sm font-medium shadow-sm backdrop-blur-sm transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-black/82 dark:hover:bg-gray-800 ${
          showDemoControls
            ? 'text-gray-950 dark:text-white'
            : 'text-gray-600 dark:text-gray-300'
        }`}
        aria-label="Demo controls"
        aria-pressed={showDemoControls}
        title="Demo controls"
      >
        <Clapperboard className="h-4 w-4" />
      </button>
      {showDemoControls ? (
        <div className="pointer-events-auto max-h-[calc(100dvh-8rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-gray-200 bg-white/94 p-2 shadow-lg backdrop-blur-sm dark:border-gray-700 dark:bg-black/86">
          <div className="grid grid-cols-3 gap-1">
            {[
              { mode: 'zones' as DemoColorMode, label: 'Zones', icon: Palette },
              { mode: 'allGreen' as DemoColorMode, label: 'Green', icon: Sparkles },
              { mode: 'random' as DemoColorMode, label: 'Random', icon: Shuffle },
            ].map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => onColorModeChange(mode)}
                className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors ${
                  demoColorMode === mode
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
                aria-pressed={demoColorMode === mode}
                title={`${label} demo colors`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {[
              { angle: 'fixed' as DemoSegmentCameraAngle, label: 'Fixed' },
              { angle: 'bird' as DemoSegmentCameraAngle, label: 'Bird' },
              { angle: 'threeD' as DemoSegmentCameraAngle, label: '3D' },
              { angle: 'street' as DemoSegmentCameraAngle, label: 'Street' },
            ].map(({ angle, label }) => (
              <button
                key={angle}
                type="button"
                onClick={() => onSegmentCameraAngleChange(angle)}
                className={`flex h-8 min-w-0 items-center justify-center rounded-md px-1.5 text-[11px] font-medium transition-colors ${
                  demoSegmentCameraAngle === angle
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
                aria-pressed={demoSegmentCameraAngle === angle}
                title={`Street segments ${label} camera`}
              >
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {[
              { speed: 'normal' as DemoCameraSpeed, label: 'Normal' },
              { speed: 'superSlow' as DemoCameraSpeed, label: 'Super slow' },
            ].map(({ speed, label }) => (
              <button
                key={speed}
                type="button"
                onClick={() => onSpeedChange(speed)}
                className={`flex h-8 min-w-0 items-center justify-center rounded-md px-2 text-[11px] font-medium transition-colors ${
                  demoCameraSpeed === speed
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
                aria-pressed={demoCameraSpeed === speed}
                title={`${label} demo speed`}
              >
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {[
              { shot: 'orbit' as DemoCameraShot, label: 'Orbit', icon: Compass },
              { shot: 'birdToStreet' as DemoCameraShot, label: 'Bird to street', icon: Film },
              { shot: 'birdFlyThrough' as DemoCameraShot, label: 'Bird fly', icon: Play },
              { shot: 'craneReveal' as DemoCameraShot, label: 'Crane reveal', icon: Film },
              { shot: 'angledPullback' as DemoCameraShot, label: 'Angle pullback', icon: Maximize2 },
              { shot: 'slideLeft' as DemoCameraShot, label: 'Slide left', icon: ArrowLeft },
              { shot: 'flyThrough' as DemoCameraShot, label: 'Fly-through', icon: Play },
              { shot: 'streetSweep' as DemoCameraShot, label: 'Street sweep', icon: RotateCw },
              { shot: 'streetSegments' as DemoCameraShot, label: 'Street segments', icon: Sparkles },
            ].map(({ shot, label, icon: Icon }) => (
              <button
                key={shot}
                type="button"
                onClick={() => onPlayShot(shot)}
                disabled={disabled}
                className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  activeDemoCameraShot === shot
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
                aria-pressed={activeDemoCameraShot === shot}
                title={`Play ${label}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
          {activeDemoCameraShot ? (
            <button
              type="button"
              onClick={onStop}
              className="mt-1.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-red-50 px-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-950/35 dark:text-red-300 dark:hover:bg-red-950/55"
              title="Stop demo camera"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function buildAssignmentPreviewAddresses(
  addressById: Map<string, CampaignAddress>,
  assignmentAddresses: AssignmentAddress[],
  zones: Map<string, AssignmentAddress[]>,
  members: ZonePreviewMember[]
) {
  const zoneAddresses = Array.from(
    new Set(members.flatMap((member) => (zones.get(member.user_id) ?? []).map((address) => address.id)))
  )
    .map((addressId) => addressById.get(addressId))
    .filter((address): address is CampaignAddress => Boolean(address));

  if (zoneAddresses.length > 0) return zoneAddresses;

  return assignmentAddresses
    .map((address) => addressById.get(address.id))
    .filter((address): address is CampaignAddress => Boolean(address));
}

function AssignmentAddressMarkerLayer({
  map,
  mapLoaded,
  assignmentAddresses,
  members,
  zones,
  colorOverrides,
}: {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  assignmentAddresses: AssignmentAddress[];
  members: ZonePreviewMember[];
  zones: Map<string, AssignmentAddress[]>;
  colorOverrides?: Record<string, string>;
}) {
  const colorByAddressId = useMemo(
    () =>
      members.reduce<Record<string, string>>((colors, member) => {
        (zones.get(member.user_id) ?? []).forEach((address) => {
          colors[address.id] = member.color;
        });
        return colors;
      }, {}),
    [members, zones]
  );
  const markerData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: assignmentAddresses.flatMap((address, index) => {
        if (!Number.isFinite(address.lon) || !Number.isFinite(address.lat)) return [];
        if (address.lon === 0 && address.lat === 0) return [];
        return [{
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [address.lon, address.lat],
          },
          properties: {
            id: address.id,
            color: colorOverrides?.[address.id] ?? colorByAddressId[address.id] ?? COLORS[index % COLORS.length],
            label: address.house_number ?? '',
          },
        }];
      }),
    }),
    [assignmentAddresses, colorByAddressId, colorOverrides]
  );

  useEffect(() => {
    if (!map || !mapLoaded || markerData.features.length === 0) return;

    const sourceId = 'assignment-address-markers-source';
    const circleLayerId = 'assignment-address-markers-circle';

    const removeLayers = () => {
      [circleLayerId].forEach((layerId) => {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        } catch {
          // Ignore transient style errors while Mapbox is swapping styles.
        }
      });
      try {
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // Ignore transient style errors while Mapbox is swapping styles.
      }
    };

    const addOrUpdateLayers = () => {
      if (!map.isStyleLoaded()) return;

      const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData(markerData);
      } else {
        map.addSource(sourceId, {
          type: 'geojson',
          data: markerData,
        });
      }

      if (!map.getLayer(circleLayerId)) {
        map.addLayer({
          id: circleLayerId,
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6],
            'circle-color': ['coalesce', ['get', 'color'], '#ef4444'],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
          },
        });
      }
    };

    addOrUpdateLayers();
    map.on('style.load', addOrUpdateLayers);
    map.on('idle', addOrUpdateLayers);

    return () => {
      map.off('style.load', addOrUpdateLayers);
      map.off('idle', addOrUpdateLayers);
      removeLayers();
    };
  }, [map, mapLoaded, markerData]);

  return null;
}

function CampaignAssignmentZonePreviewMap({
  campaignId,
  addresses,
  assignmentAddresses,
  members,
  autoZones,
  zones,
  manualOverrides,
  showAssignmentColors,
  editable,
  onApplyManualOverrides,
}: {
  campaignId: string;
  addresses: CampaignAddress[];
  assignmentAddresses: AssignmentAddress[];
  members: ZonePreviewMember[];
  autoZones: Map<string, AssignmentAddress[]>;
  zones: Map<string, AssignmentAddress[]>;
  manualOverrides: Record<string, string>;
  showAssignmentColors: boolean;
  editable: boolean;
  onApplyManualOverrides: (overrides: Record<string, string>) => void;
}) {
  const { theme } = useTheme();
  const { preset: mapPreset } = useMapStyle();
  const { currentWorkspaceId } = useWorkspace();
  const { movieMapControlsEnabled } = useMovieMapControlsEnabled(currentWorkspaceId);
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle(mapPreset, theme, 'v12'),
    [mapPreset, theme]
  );
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [buildingRenderState, setBuildingRenderState] = useState<MapBuildingsRenderState | null>(null);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStartDraw, setEditorStartDraw] = useState(false);
  const addressById = useMemo(() => new Map(addresses.map((address) => [address.id, address])), [addresses]);

  const previewPoints = useMemo<ZonePreviewPoint[]>(
    () =>
      members.flatMap((member) => {
        return (zones.get(member.user_id) ?? []).flatMap((address) => {
          if (!Number.isFinite(address.lon) || !Number.isFinite(address.lat)) return [];
          if (address.lon === 0 && address.lat === 0) return [];
          return [{
            lon: address.lon,
            lat: address.lat,
          }];
        });
      }),
    [members, zones]
  );
  const assignmentColorByAddressId = useMemo(
    () => {
      if (!showAssignmentColors) return {};
      return members.reduce<Record<string, string>>((colors, member) => {
        (zones.get(member.user_id) ?? []).forEach((address) => {
          colors[address.id] = member.color;
        });
        return colors;
      }, {});
    },
    [members, showAssignmentColors, zones]
  );
  const demoCamera = useAssignmentDemoCamera({
    mapRef,
    mapLoaded,
    assignmentAddresses,
    previewPoints,
    baseColorByAddressId: showAssignmentColors ? assignmentColorByAddressId : undefined,
    enabled: movieMapControlsEnabled,
  });
  const previewAddresses = useMemo(
    () => buildAssignmentPreviewAddresses(addressById, assignmentAddresses, zones, members),
    [addressById, assignmentAddresses, members, zones]
  );

  const initialPoint = previewPoints[0] ?? null;
  const initialLon = initialPoint?.lon ?? null;
  const initialLat = initialPoint?.lat ?? null;
  const showFallbackMarkers = Boolean(
    buildingRenderState &&
    !buildingRenderState.isFetching &&
    !buildingRenderState.hasVisibleFeatures
  );
  const hasRenderableAssignmentMap = Boolean(mapLoaded || buildingRenderState?.hasVisibleFeatures);
  const showMapError = Boolean(mapError && !hasRenderableAssignmentMap);

  useEffect(() => {
    if (buildingRenderState?.hasVisibleFeatures) {
      setMapError(null);
    }
  }, [buildingRenderState?.hasVisibleFeatures]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || initialLon === null || initialLat === null) return;

    const token = getMapboxToken();
    if (!token) {
      setMapError('Mapbox token not configured.');
      return;
    }

    let cancelled = false;
    setMapError(null);
    setMapLoaded(false);
    mapboxgl.accessToken = token;

    void getResolvedMapInitOptions(resolvedMapStyle)
      .then((initOptions) => {
        if (cancelled || !mapContainerRef.current) return;

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          ...initOptions,
          center: [initialLon, initialLat],
          zoom: 14.5,
          pitch: 45,
          attributionControl: false,
          pitchWithRotate: true,
          dragRotate: true,
        });
        mapRef.current = map;
        enableFreeMapCamera(map);
        map.addControl(new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
        map.on('style.load', () => {
          if (cancelled) return;
          applyPresetVisualTweaks(map, resolvedMapStyle, {
            preserveLayerPrefixes: ['map-buildings-', 'campaign-', 'flyr-', 'gl-draw-'],
          });
          syncMapSize(map);
          setMapLoaded(true);
          setMapError(null);
        });
        map.on('load', () => {
          if (!cancelled) {
            setMapLoaded(true);
            setMapError(null);
            window.requestAnimationFrame(() => syncMapSize(map));
          }
        });
        map.on('error', () => {
          if (cancelled) return;
          if (hasRenderableMapStyle(map)) {
            setMapError(null);
            return;
          }

          window.setTimeout(() => {
            if (cancelled || mapRef.current !== map) return;
            if (hasRenderableMapStyle(map)) {
              setMapError(null);
              return;
            }
            setMapError('Map unavailable.');
          }, 1000);
        });
      })
      .catch(() => {
        if (!cancelled) setMapError('Map unavailable.');
      });

    return () => {
      cancelled = true;
      setMapLoaded(false);
      if (mapRef.current) {
        removeMapboxMapWhenSafe(mapRef.current);
        mapRef.current = null;
      }
    };
  }, [initialLat, initialLon, resolvedMapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || previewPoints.length === 0) return;

    if (previewPoints.length === 1) {
      map.easeTo({ center: [previewPoints[0].lon, previewPoints[0].lat], zoom: 17, pitch: 45, duration: 450 });
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    previewPoints.forEach((point) => bounds.extend([point.lon, point.lat]));
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 44, right: 44, bottom: 44, left: 44 },
        maxZoom: 17,
        pitch: 45,
        duration: 450,
      });
    }
  }, [mapLoaded, previewPoints]);

  useEffect(() => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container || !mapLoaded) return;

    let frameId: number | null = null;
    const resizeMap = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        syncMapSize(map);
        frameId = null;
      });
    };

    const observer = new ResizeObserver(resizeMap);
    observer.observe(container);
    window.addEventListener('resize', resizeMap);
    window.addEventListener('orientationchange', resizeMap);
    resizeMap();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeMap);
      window.removeEventListener('orientationchange', resizeMap);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const resizeDelays = expandedOpen ? [0, 80, 180, 320] : [0, 120];
    const timerIds = resizeDelays.map((delay) =>
      window.setTimeout(() => {
        syncMapSize(map);
      }, delay)
    );

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [expandedOpen, mapLoaded]);

  if (previewPoints.length === 0) {
    return null;
  }

  const openEditor = (startDraw: boolean) => {
    setEditorStartDraw(startDraw);
    setEditorOpen(true);
  };

  const wrapperClassName = expandedOpen
    ? 'fixed inset-0 z-[70] grid h-[100dvh] w-[100vw] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-none border-0 bg-background'
    : 'overflow-hidden rounded-lg border border-border bg-muted/20';
  const mapFrameClassName = expandedOpen
    ? 'relative h-full min-h-0 w-full'
    : 'relative h-[360px] min-h-[320px] w-full';

  return (
    <div className={wrapperClassName}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/85 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MapPinned className="h-4 w-4 text-muted-foreground" />
          <p className="truncate text-sm font-medium text-foreground">Assignment map</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {expandedOpen ? null : (
            <Button type="button" variant="outline" size="sm" onClick={() => setExpandedOpen(true)}>
              <Expand className="h-3.5 w-3.5" />
              Expand
            </Button>
          )}
          {editable ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => openEditor(false)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit map
            </Button>
          ) : null}
          {members.map((member) => (
            <span key={member.user_id} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.color }} />
              <span className="max-w-[140px] truncate">{member.display_name}</span>
            </span>
          ))}
        </div>
      </div>
      <div className={mapFrameClassName}>
        <div ref={mapContainerRef} className="h-full w-full" />
        {mapRef.current && mapLoaded ? (
          <>
            {showFallbackMarkers ? (
              <AssignmentAddressMarkerLayer
                map={mapRef.current}
                mapLoaded={mapLoaded}
                assignmentAddresses={assignmentAddresses}
                members={members}
                zones={zones}
                colorOverrides={demoCamera.demoColorByAddressId}
              />
            ) : null}
            <MapBuildingsLayer
              map={mapRef.current}
              campaignId={campaignId}
              addressStateOverrides={previewAddresses}
              assignmentColorByAddressId={demoCamera.demoColorByAddressId}
              visibleAddressIds={assignmentAddresses.map((address) => address.id)}
              showAddressLabels={false}
              footprintStatusColors
              isDarkMap={theme === 'dark'}
              onRenderStateChange={setBuildingRenderState}
            />
          </>
        ) : null}
        <AssignmentDemoCameraControls
          activeDemoCameraShot={demoCamera.activeDemoCameraShot}
          demoCameraSpeed={demoCamera.demoCameraSpeed}
          demoColorMode={demoCamera.demoColorMode}
          demoSegmentCameraAngle={demoCamera.demoSegmentCameraAngle}
          disabled={!mapLoaded}
          enabled={movieMapControlsEnabled}
          onColorModeChange={demoCamera.handleDemoColorModeChange}
          onPlayShot={demoCamera.playDemoCamera}
          onSegmentCameraAngleChange={demoCamera.setDemoSegmentCameraAngle}
          onSpeedChange={demoCamera.setDemoCameraSpeed}
          onStop={demoCamera.stopDemoCamera}
          setShowDemoControls={demoCamera.setShowDemoControls}
          showDemoControls={demoCamera.showDemoControls}
        />
        {showMapError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-4 text-center text-sm text-muted-foreground">
            {mapError}
          </div>
        ) : null}
      </div>
      {expandedOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background px-4 py-3">
          <p className="text-xs text-muted-foreground">{assignmentAddresses.length} homes</p>
          <Button type="button" variant="outline" onClick={() => setExpandedOpen(false)}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>
      ) : null}
      <AssignmentMapEditorDialog
        open={editorOpen}
        startInDrawMode={editorStartDraw}
        editable
        campaignId={campaignId}
        addresses={addresses}
        assignmentAddresses={assignmentAddresses}
        members={members}
        autoZones={autoZones}
        displayZones={zones}
        showAssignmentColors={showAssignmentColors}
        appliedManualOverrides={manualOverrides}
        onApplyManualOverrides={onApplyManualOverrides}
        onOpenChange={setEditorOpen}
      />
    </div>
  );
}

function AssignmentMapEditorDialog({
  open,
  startInDrawMode,
  editable,
  campaignId,
  addresses,
  assignmentAddresses,
  members,
  autoZones,
  displayZones,
  showAssignmentColors,
  appliedManualOverrides,
  onApplyManualOverrides,
  onOpenChange,
}: {
  open: boolean;
  startInDrawMode: boolean;
  editable: boolean;
  campaignId: string;
  addresses: CampaignAddress[];
  assignmentAddresses: AssignmentAddress[];
  members: ZonePreviewMember[];
  autoZones: Map<string, AssignmentAddress[]>;
  displayZones: Map<string, AssignmentAddress[]>;
  showAssignmentColors: boolean;
  appliedManualOverrides: Record<string, string>;
  onApplyManualOverrides: (overrides: Record<string, string>) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { theme } = useTheme();
  const { preset: mapPreset } = useMapStyle();
  const { currentWorkspaceId } = useWorkspace();
  const { movieMapControlsEnabled } = useMovieMapControlsEnabled(currentWorkspaceId);
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle(mapPreset, theme, 'v12'),
    [mapPreset, theme]
  );
  const memberIds = useMemo(() => members.map((member) => member.user_id), [members]);
  const addressById = useMemo(() => new Map(addresses.map((address) => [address.id, address])), [addresses]);
  const assignmentAddressIdSet = useMemo(
    () => new Set(assignmentAddresses.map((address) => address.id)),
    [assignmentAddresses]
  );
  const autoAssignmentByAddress = useMemo(() => buildAssignmentByAddressId(autoZones), [autoZones]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [buildingRenderState, setBuildingRenderState] = useState<MapBuildingsRenderState | null>(null);
  const [selectedAddressIds, setSelectedAddressIds] = useState<string[]>([]);
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string>>({});
  const [activeMemberId, setActiveMemberId] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setSelectedAddressIds([]);
    setDraftOverrides(appliedManualOverrides);
    setActiveMemberId((current) =>
      current && memberIds.includes(current) ? current : memberIds[0] ?? ''
    );
  }, [appliedManualOverrides, memberIds, open]);

  const editorZones = useMemo(
    () =>
      editable
        ? applyManualOverridesToZones(autoZones, assignmentAddresses, memberIds, draftOverrides)
        : displayZones,
    [assignmentAddresses, autoZones, displayZones, draftOverrides, editable, memberIds]
  );
  const manualCountsByMember = useMemo(
    () => countManualOverridesByMember(draftOverrides, assignmentAddresses, memberIds, autoZones),
    [assignmentAddresses, autoZones, draftOverrides, memberIds]
  );
  const assignmentColorByAddressId = useMemo(
    () => {
      if (!showAssignmentColors) return {};
      return members.reduce<Record<string, string>>((colors, member) => {
        (editorZones.get(member.user_id) ?? []).forEach((address) => {
          colors[address.id] = member.color;
        });
        return colors;
      }, {});
    },
    [editorZones, members, showAssignmentColors]
  );
  const previewAddresses = useMemo(
    () => buildAssignmentPreviewAddresses(addressById, assignmentAddresses, editorZones, members),
    [addressById, assignmentAddresses, editorZones, members]
  );
  const previewPoints = useMemo<ZonePreviewPoint[]>(
    () =>
      assignmentAddresses.flatMap((address) => {
        if (!Number.isFinite(address.lon) || !Number.isFinite(address.lat)) return [];
        if (address.lon === 0 && address.lat === 0) return [];
        return [{ lon: address.lon, lat: address.lat }];
      }),
    [assignmentAddresses]
  );
  const demoCamera = useAssignmentDemoCamera({
    mapRef,
    mapLoaded,
    assignmentAddresses,
    previewPoints,
    baseColorByAddressId: showAssignmentColors ? assignmentColorByAddressId : undefined,
    enabled: movieMapControlsEnabled,
  });
  const initialPoint = previewPoints[0] ?? null;
  const initialLon = initialPoint?.lon ?? null;
  const initialLat = initialPoint?.lat ?? null;
  const showFallbackMarkers = Boolean(
    buildingRenderState &&
    !buildingRenderState.isFetching &&
    !buildingRenderState.hasVisibleFeatures
  );
  const hasRenderableAssignmentMap = Boolean(mapLoaded || buildingRenderState?.hasVisibleFeatures);
  const showMapError = Boolean(mapError && !hasRenderableAssignmentMap);

  useEffect(() => {
    if (buildingRenderState?.hasVisibleFeatures) {
      setMapError(null);
    }
  }, [buildingRenderState?.hasVisibleFeatures]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!open || !container || initialLon === null || initialLat === null) return;

    const token = getMapboxToken();
    if (!token) {
      setMapError('Mapbox token not configured.');
      return;
    }

    let cancelled = false;
    setMapError(null);
    setMapLoaded(false);
    mapboxgl.accessToken = token;

    void Promise.all([
      getResolvedMapInitOptions(resolvedMapStyle),
      editable ? import('@mapbox/mapbox-gl-draw') : Promise.resolve(null),
    ])
      .then(([initOptions, drawModule]) => {
        if (cancelled || !mapContainerRef.current) return;

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          ...initOptions,
          center: [initialLon, initialLat],
          zoom: 15,
          pitch: 45,
          attributionControl: false,
          pitchWithRotate: true,
          dragRotate: true,
        });
        mapRef.current = map;
        enableFreeMapCamera(map);
        map.addControl(new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');

        const draw = drawModule
          ? new drawModule.default({
              displayControlsDefault: false,
              controls: {},
            })
          : null;
        drawRef.current = draw;

        const updateSelectionFromDraw = () => {
          if (!drawRef.current) return;
          setSelectedAddressIds(selectedAddressIdsFromDraw(drawRef.current, assignmentAddresses));
        };
        const drawMap = map as mapboxgl.Map & {
          on(type: string, listener: () => void): mapboxgl.Map;
          off(type: string, listener: () => void): mapboxgl.Map;
        };

        const handleMapReady = () => {
          applyPresetVisualTweaks(map, resolvedMapStyle, {
            preserveLayerPrefixes: ['map-buildings-', 'campaign-', 'flyr-', 'gl-draw-'],
          });
          syncMapSize(map);
        };

        const handleStyleLoad = () => {
          if (cancelled) return;
          handleMapReady();
          setMapLoaded(true);
          setMapError(null);
        };

        map.on('style.load', handleStyleLoad);
        map.on('load', () => {
          if (cancelled) return;
          try {
            handleMapReady();
            if (!draw) {
              setMapLoaded(true);
              setMapError(null);
              window.requestAnimationFrame(() => syncMapSize(map));
              return;
            }
            map.addControl(draw);
            drawMap.on('draw.create', updateSelectionFromDraw);
            drawMap.on('draw.update', updateSelectionFromDraw);
            drawMap.on('draw.delete', updateSelectionFromDraw);
            if (startInDrawMode) {
              window.setTimeout(() => draw.changeMode('draw_polygon'), 0);
            }
          } catch {
            // The map remains useful for click editing if Draw cannot attach.
          }
          setMapLoaded(true);
          setMapError(null);
          window.requestAnimationFrame(() => syncMapSize(map));
        });
        map.on('error', () => {
          if (cancelled) return;
          if (hasRenderableMapStyle(map)) {
            setMapError(null);
            return;
          }

          window.setTimeout(() => {
            if (cancelled || mapRef.current !== map) return;
            if (hasRenderableMapStyle(map)) {
              setMapError(null);
              return;
            }
            setMapError('Map unavailable.');
          }, 1000);
        });

        const cleanupDrawEvents = () => {
          drawMap.off('draw.create', updateSelectionFromDraw);
          drawMap.off('draw.update', updateSelectionFromDraw);
          drawMap.off('draw.delete', updateSelectionFromDraw);
          map.off('style.load', handleStyleLoad);
        };
        map.once('remove', cleanupDrawEvents);
      })
      .catch(() => {
        if (!cancelled) setMapError('Map unavailable.');
      });

    return () => {
      cancelled = true;
      setMapLoaded(false);
      if (mapRef.current) {
        try {
          if (drawRef.current) mapRef.current.removeControl(drawRef.current);
        } catch {
          // Mapbox can already be mid-disposal here.
        }
        removeMapboxMapWhenSafe(mapRef.current);
        mapRef.current = null;
        drawRef.current = null;
      }
    };
  }, [assignmentAddresses, editable, initialLat, initialLon, open, resolvedMapStyle, startInDrawMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || previewPoints.length === 0) return;

    if (previewPoints.length === 1) {
      map.easeTo({ center: [previewPoints[0].lon, previewPoints[0].lat], zoom: 17, pitch: 45, duration: 450 });
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    previewPoints.forEach((point) => bounds.extend([point.lon, point.lat]));
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 56, right: 56, bottom: 56, left: 56 },
        maxZoom: 17.25,
        pitch: 45,
        duration: 450,
      });
    }
  }, [mapLoaded, previewPoints]);

  useEffect(() => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!open || !map || !container || !mapLoaded) return;

    let frameId: number | null = null;
    const resizeMap = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        syncMapSize(map);
        frameId = null;
      });
    };

    const observer = new ResizeObserver(resizeMap);
    observer.observe(container);
    window.addEventListener('resize', resizeMap);
    window.addEventListener('orientationchange', resizeMap);

    resizeMap();
    const settleTimers = [50, 150, 300].map((delay) => window.setTimeout(resizeMap, delay));

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeMap);
      window.removeEventListener('orientationchange', resizeMap);
      settleTimers.forEach((timerId) => window.clearTimeout(timerId));
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [mapLoaded, open]);

  const drawPolygon = () => {
    const draw = drawRef.current;
    if (!draw) return;
    draw.deleteAll();
    setSelectedAddressIds([]);
    draw.changeMode('draw_polygon');
  };

  const clearSelection = () => {
    drawRef.current?.deleteAll();
    setSelectedAddressIds([]);
  };

  const assignAddressIdsToMember = useCallback((addressIds: string[], memberId: string) => {
    if (!memberId || addressIds.length === 0) return;

    setDraftOverrides((current) => {
      const next = { ...current };
      addressIds.forEach((addressId) => {
        if (!assignmentAddressIdSet.has(addressId)) return;
        if (autoAssignmentByAddress.get(addressId) === memberId) {
          delete next[addressId];
          return;
        }
        next[addressId] = memberId;
      });
      return sanitizeManualOverrides(next, assignmentAddresses, memberIds, autoZones);
    });
  }, [assignmentAddressIdSet, assignmentAddresses, autoAssignmentByAddress, autoZones, memberIds]);

  const assignSelectionToMember = () => {
    assignAddressIdsToMember(selectedAddressIds, activeMemberId);
  };

  const resetEdits = () => {
    setDraftOverrides({});
    clearSelection();
  };

  const applyEdits = () => {
    const sanitized = sanitizeManualOverrides(draftOverrides, assignmentAddresses, memberIds, autoZones);
    onApplyManualOverrides(sanitized);
    onOpenChange(false);
  };

  const handleBuildingClick = useCallback((
    _buildingId: string,
    addressId?: string,
    options?: { additive?: boolean }
  ) => {
    if (!addressId || !assignmentAddressIdSet.has(addressId)) return;
    const memberId = activeMemberId;
    setSelectedAddressIds((current) => {
      const exists = current.includes(addressId);
      if (options?.additive) {
        return exists ? current.filter((id) => id !== addressId) : [...current, addressId];
      }
      return [addressId];
    });
    if (memberId && !options?.additive) {
      assignAddressIdsToMember([addressId], memberId);
    }
  }, [activeMemberId, assignAddressIdsToMember, assignmentAddressIdSet]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="left-0 top-0 grid h-[100dvh] w-[100vw] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        showCloseButton={false}
        style={{
          inset: 0,
          width: '100vw',
          height: '100dvh',
          maxWidth: 'none',
          transform: 'none',
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Assignment map editor</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <MapPinned className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Assignment map</p>
              {editable ? <p className="text-xs text-muted-foreground">{selectedAddressIds.length} selected</p> : null}
            </div>
          </div>
          {editable ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={drawPolygon}>
                <PenLine className="h-3.5 w-3.5" />
                Draw polygon
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearSelection}
                disabled={selectedAddressIds.length === 0}
              >
                <Eraser className="h-3.5 w-3.5" />
                Clear selection
              </Button>
            </div>
          ) : null}
        </div>

        <div className="relative min-h-0">
          <div ref={mapContainerRef} className="h-full min-h-0 w-full" />
          {editable ? (
            <div className="absolute left-4 top-4 z-10 max-h-[calc(100%-2rem)] w-[min(340px,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Assign to</Label>
                  <div className="space-y-2">
                    {members.map((member) => {
                      const active = activeMemberId === member.user_id;
                      const zoneHomes = editorZones.get(member.user_id) ?? [];
                      const manualCount = manualCountsByMember.get(member.user_id) ?? 0;
                      return (
                        <button
                          key={member.user_id}
                          type="button"
                          onClick={() => setActiveMemberId(member.user_id)}
                          className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                            active
                              ? 'border-foreground bg-background text-foreground'
                              : 'border-border bg-background/70 text-muted-foreground hover:bg-background'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: member.color }} />
                            <span className="truncate text-sm font-medium">{member.display_name}</span>
                          </span>
                          <span className="shrink-0 text-xs">
                            {zoneHomes.length} / {manualCount} edited
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Button
                  type="button"
                  className="w-full"
                  onClick={assignSelectionToMember}
                  disabled={!activeMemberId || selectedAddressIds.length === 0}
                >
                  <Check className="h-4 w-4" />
                  Assign selected
                </Button>

                <Button type="button" variant="outline" className="w-full" onClick={resetEdits}>
                  <RotateCcw className="h-4 w-4" />
                  Reset edits
                </Button>
              </div>
            </div>
          ) : null}
          {mapRef.current && mapLoaded ? (
            <>
              {showFallbackMarkers ? (
                <AssignmentAddressMarkerLayer
                  map={mapRef.current}
                  mapLoaded={mapLoaded}
                  assignmentAddresses={assignmentAddresses}
                  members={members}
                  zones={editorZones}
                  colorOverrides={demoCamera.demoColorByAddressId}
                />
              ) : null}
              <MapBuildingsLayer
                map={mapRef.current}
                campaignId={campaignId}
                addressStateOverrides={previewAddresses}
                assignmentColorByAddressId={demoCamera.demoColorByAddressId}
                selectedAddressIds={selectedAddressIds}
                visibleAddressIds={assignmentAddresses.map((address) => address.id)}
                showAddressLabels={false}
                footprintStatusColors
                isDarkMap={theme === 'dark'}
                onBuildingClick={editable ? handleBuildingClick : undefined}
                onRenderStateChange={setBuildingRenderState}
              />
            </>
          ) : null}
          <AssignmentDemoCameraControls
            activeDemoCameraShot={demoCamera.activeDemoCameraShot}
            demoCameraSpeed={demoCamera.demoCameraSpeed}
            demoColorMode={demoCamera.demoColorMode}
            demoSegmentCameraAngle={demoCamera.demoSegmentCameraAngle}
            disabled={!mapLoaded}
            enabled={movieMapControlsEnabled}
            onColorModeChange={demoCamera.handleDemoColorModeChange}
            onPlayShot={demoCamera.playDemoCamera}
            onSegmentCameraAngleChange={demoCamera.setDemoSegmentCameraAngle}
            onSpeedChange={demoCamera.setDemoCameraSpeed}
            onStop={demoCamera.stopDemoCamera}
            setShowDemoControls={demoCamera.setShowDemoControls}
            showDemoControls={demoCamera.showDemoControls}
          />
          {showMapError ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-4 text-center text-sm text-muted-foreground">
              {mapError}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background px-4 py-3">
          {editable ? (
            <p className="text-xs text-muted-foreground">
              {Object.keys(sanitizeManualOverrides(draftOverrides, assignmentAddresses, memberIds, autoZones)).length} manual edits
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{assignmentAddresses.length} homes</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              {editable ? 'Cancel' : 'Close'}
            </Button>
            {editable ? (
              <Button type="button" onClick={applyEdits}>
                <Check className="h-4 w-4" />
                Apply edits
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CampaignAssignmentView({ campaignId, campaignName, addresses }: CampaignAssignmentViewProps) {
  const { currentWorkspace, membershipsByWorkspaceId } = useWorkspace();
  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canManage = currentRole === 'owner' || currentRole === 'admin';

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [mode, setMode] = useState<CampaignAssignmentMode>('zone_split');
  const [splitMode, setSplitMode] = useState<CampaignAssignmentSplitMode>('smart');
  const [appliedManualOverrides, setAppliedManualOverrides] = useState<Record<string, string>>({});
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const assignmentAddresses = useMemo(() => toAssignmentAddresses(addresses), [addresses]);
  const autoZones = useMemo(
    () => buildZones(assignmentAddresses, selectedMemberIds, splitMode),
    [assignmentAddresses, selectedMemberIds, splitMode]
  );
  const zones = useMemo(
    () => applyManualOverridesToZones(autoZones, assignmentAddresses, selectedMemberIds, appliedManualOverrides),
    [appliedManualOverrides, assignmentAddresses, autoZones, selectedMemberIds]
  );
  const manualOverrideCountByMemberId = useMemo(
    () => countManualOverridesByMember(appliedManualOverrides, assignmentAddresses, selectedMemberIds, autoZones),
    [appliedManualOverrides, assignmentAddresses, autoZones, selectedMemberIds]
  );
  const previewZones = useMemo(() => {
    if (mode === 'zone_split') return zones;

    const wholeTeamZones = new Map<string, AssignmentAddress[]>();
    if (selectedMemberIds[0]) wholeTeamZones.set(selectedMemberIds[0], assignmentAddresses);
    return wholeTeamZones;
  }, [assignmentAddresses, mode, selectedMemberIds, zones]);

  useEffect(() => {
    setAppliedManualOverrides((current) => {
      const next = sanitizeManualOverrides(current, assignmentAddresses, selectedMemberIds, autoZones);
      return shallowRecordEqual(current, next) ? current : next;
    });
  }, [assignmentAddresses, autoZones, selectedMemberIds]);

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/assignments`, {
        credentials: 'include',
      });
      const payload = (await response.json().catch(() => null)) as
        | { assignments?: AssignmentRow[]; error?: string }
        | null;
      if (!response.ok) {
        setMessage(payload?.error ?? 'Failed to load assignments.');
        setAssignments([]);
        return;
      }
      setAssignments(Array.isArray(payload?.assignments) ? payload.assignments : []);
    } catch {
      setMessage('Failed to load assignments.');
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  useEffect(() => {
    if (!canManage || !currentWorkspaceId) {
      setMembers([]);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const response = await fetch(`/api/team/roster?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
          credentials: 'include',
        });
        const payload = (await response.json().catch(() => null)) as { members?: TeamMember[] } | null;
        if (!mounted) return;
        const roster = Array.isArray(payload?.members) ? payload.members : [];
        setMembers(roster);
        setSelectedMemberIds((current) => {
          if (current.length > 0) return current.filter((id) => roster.some((member) => member.user_id === id));
          const defaultMembers = roster.filter((member) => member.role !== 'owner').map((member) => member.user_id);
          return defaultMembers.length > 0 ? defaultMembers : roster.map((member) => member.user_id);
        });
      } catch {
        if (!mounted) return;
        setMembers([]);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [canManage, currentWorkspaceId]);

  const selectedMembers = useMemo(
    () => members.filter((member) => selectedMemberIds.includes(member.user_id)),
    [members, selectedMemberIds]
  );
  const zonePreviewMembers = useMemo<ZonePreviewMember[]>(
    () =>
      selectedMembers.map((member, index) => ({
        user_id: member.user_id,
        display_name: member.display_name,
        color: COLORS[index % COLORS.length],
      })),
    [selectedMembers]
  );

  const handleSave = useCallback(async () => {
    if (!currentWorkspaceId) {
      setMessage('No workspace selected.');
      return;
    }
    if (selectedMemberIds.length === 0) {
      setMessage('Select at least one team member.');
      return;
    }
    if (mode === 'zone_split' && selectedMemberIds.length > assignmentAddresses.length) {
      setMessage('Not enough geocoded homes to give every selected member a zone.');
      return;
    }

    setSaving(true);
    setMessage(null);
    setWarnings([]);

    const zoneAssignments =
      mode === 'zone_split'
        ? selectedMemberIds.map((memberId) => ({
            userId: memberId,
            addressIds: (zones.get(memberId) ?? []).map((address) => address.id),
          }))
        : undefined;

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          mode,
          memberIds: selectedMemberIds,
          dueAt: dueAt ? `${dueAt}T23:59:59` : null,
          notes: notes || null,
          splitMode,
          zoneAssignments,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { assignments?: AssignmentRow[]; warnings?: string[]; error?: string }
        | null;

      if (!response.ok) {
        setMessage(payload?.error ?? 'Failed to assign campaign.');
        return;
      }

      setAssignments(Array.isArray(payload?.assignments) ? payload.assignments : []);
      setWarnings(Array.isArray(payload?.warnings) ? payload.warnings : []);
      setMessage('Campaign assigned.');
      setNotes('');
      setDueAt('');
    } catch {
      setMessage('Failed to assign campaign.');
    } finally {
      setSaving(false);
    }
  }, [
    assignmentAddresses.length,
    campaignId,
    currentWorkspaceId,
    dueAt,
    mode,
    notes,
    selectedMemberIds,
    splitMode,
    zones,
  ]);

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaign Assignment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading assignment...</p> : null}
          {!loading && assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">This campaign has not been assigned to you yet.</p>
          ) : null}
          {assignments.map((assignment) => (
            <div key={assignment.id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{campaignName ?? 'Campaign'}</p>
                  <p className="text-xs text-muted-foreground">{formatMode(assignment.mode)}</p>
                </div>
                <Badge variant="secondary">{assignment.goal_homes} homes</Badge>
              </div>
              {assignment.due_at ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Due {new Date(assignment.due_at).toLocaleDateString()}
                </p>
              ) : null}
              {assignment.notes ? <p className="mt-2 text-xs text-muted-foreground">{assignment.notes}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Assign Campaign
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Assignment mode</Label>
              <div className="inline-flex rounded-lg border border-border bg-muted/20 p-1">
                <button
                  type="button"
                  onClick={() => setMode('zone_split')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'zone_split' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background/80'
                  }`}
                >
                  Zone split
                </button>
                <button
                  type="button"
                  onClick={() => setMode('whole_team')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'whole_team' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background/80'
                  }`}
                >
                  Whole team
                </button>
              </div>
            </div>
            {mode === 'zone_split' ? (
              <div className="space-y-2">
                <Label>Split logic</Label>
                <div className="inline-flex rounded-lg border border-border bg-muted/20 p-1">
                  <button
                    type="button"
                    onClick={() => setSplitMode('smart')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      splitMode === 'smart' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background/80'
                    }`}
                  >
                    Smart Territory Split
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitMode('balanced')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      splitMode === 'balanced' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background/80'
                    }`}
                  >
                    Equal Count
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Members</Label>
            <div className="flex flex-wrap gap-2">
              {members.map((member) => {
                const selected = selectedMemberIds.includes(member.user_id);
                return (
                  <Button
                    key={member.user_id}
                    type="button"
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    onClick={() =>
                      setSelectedMemberIds((current) =>
                        current.includes(member.user_id)
                          ? current.filter((id) => id !== member.user_id)
                          : [...current, member.user_id]
                      )
                    }
                    disabled={saving}
                  >
                    {member.display_name}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="campaign-assignment-due">Due date</Label>
              <Input
                id="campaign-assignment-due"
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="mt-1"
                disabled={saving}
              />
            </div>
            <div>
              <Label htmlFor="campaign-assignment-notes">Notes</Label>
              <Input
                id="campaign-assignment-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Instructions for the team"
                className="mt-1"
                disabled={saving}
              />
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {addresses.length} campaign homes ready for assignment.
          </div>

          {zonePreviewMembers.length > 0 ? (
            <CampaignAssignmentZonePreviewMap
              campaignId={campaignId}
              addresses={addresses}
              assignmentAddresses={assignmentAddresses}
              members={zonePreviewMembers}
              autoZones={autoZones}
              zones={previewZones}
              manualOverrides={appliedManualOverrides}
              showAssignmentColors={mode === 'zone_split'}
              editable={mode === 'zone_split'}
              onApplyManualOverrides={setAppliedManualOverrides}
            />
          ) : null}

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          {warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              {warnings.slice(0, 3).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <Button className="w-full" onClick={() => void handleSave()} disabled={saving || selectedMemberIds.length === 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Assign Campaign
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {selectedMembers.map((member, index) => {
          const zoneHomes = zones.get(member.user_id) ?? [];
          const goal = mode === 'zone_split' ? zoneHomes.length : addresses.length;
          const manualCount = manualOverrideCountByMemberId.get(member.user_id) ?? 0;
          return (
            <Card key={member.user_id}>
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="truncate text-sm">{member.display_name}</CardTitle>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {mode === 'zone_split' && manualCount > 0 ? (
                      <Badge variant="outline">{manualCount} edited</Badge>
                    ) : null}
                    <Badge variant="secondary">{goal} homes</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  {mode === 'zone_split' ? `Zone ${index + 1}` : 'Whole campaign'}
                </div>
                {mode === 'zone_split' ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {zoneHomes
                      .slice(0, 4)
                      .map((address) => address.formatted || address.street_name || address.id.slice(0, 8))
                      .join(', ')}
                    {zoneHomes.length > 4 ? '...' : ''}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">No exclusive zone. The selected team works the campaign together.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {assignments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current Assignments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{assignment.assignee?.display_name ?? assignment.assigned_to_user_id.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">{formatMode(assignment.mode)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{assignment.goal_homes} homes</Badge>
                  <Link href={`/campaigns/${campaignId}`} className="text-xs font-medium text-primary hover:underline">
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No assignments yet. Use the form above to assign this campaign to a team member.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
