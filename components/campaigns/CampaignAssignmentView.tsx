'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Compass,
  Expand,
  Film,
  Loader2,
  MapPinned,
  Maximize2,
  MousePointer2,
  Palette,
  Pencil,
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
import { selectedAddressIdsFromFeatures } from '@/lib/campaignAssignmentMapSelection';
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
import { Textarea } from '@/components/ui/textarea';

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
  demoMode?: boolean;
  demoLivePlaybackToken?: number;
  onDemoSplitComplete?: () => void;
};

type AssignmentAddress = BuildRouteAddress & {
  sequence: number;
};

const COLORS = ['#ef4444', '#14b8a6', '#3b82f6', '#8b5cf6', '#d946ef', '#f97316'];
const SELF_SERVE_DEMO_MEMBERS: TeamMember[] = [
  { user_id: 'demo-maya', display_name: 'Maya', role: 'member' },
  { user_id: 'demo-leo', display_name: 'Leo', role: 'member' },
  { user_id: 'demo-ava', display_name: 'Ava', role: 'member' },
  { user_id: 'demo-noah', display_name: 'Noah', role: 'member' },
];
const DEMO_GREEN_COLOR = '#22c55e';
const DEMO_RANDOM_COLORS = ['#ffffff', '#3b82f6', '#ef4444', '#8b5cf6', '#f97316', '#06b6d4', '#eab308'];
const DEMO_CAMERA_PITCH_STREET_DEGREES = 68;
const DEMO_CAMERA_PITCH_3D_DEGREES = 62;
const DEMO_CAMERA_ZOOM_STREET = 18.15;
const ASSIGNMENT_LIVE_DEMO_ROUTE_SOURCE_ID = 'assignment-live-demo-routes';
const ASSIGNMENT_LIVE_DEMO_ROUTE_LAYER_ID = 'assignment-live-demo-route-lines';
const ASSIGNMENT_LIVE_DEMO_REP_SOURCE_ID = 'assignment-live-demo-reps';
const ASSIGNMENT_LIVE_DEMO_REP_LAYER_ID = 'assignment-live-demo-rep-pucks';
const ASSIGNMENT_LIVE_DEMO_REP_LABEL_LAYER_ID = 'assignment-live-demo-rep-labels';
const ASSIGNMENT_ZONE_LABEL_SOURCE_ID = 'assignment-zone-labels';
const ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID = 'assignment-zone-label-circles';
const ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID = 'assignment-zone-label-text';
const ASSIGNMENT_LASSO_SOURCE_ID = 'assignment-editor-lasso';
const ASSIGNMENT_LASSO_FILL_LAYER_ID = 'assignment-editor-lasso-fill';
const ASSIGNMENT_LASSO_LINE_LAYER_ID = 'assignment-editor-lasso-line';

type ZonePreviewMember = {
  user_id: string;
  display_name: string;
  color: string;
};

type ZonePreviewPoint = {
  lon: number;
  lat: number;
};
type AssignmentCampaignReportRow = {
  id: string;
  name: string;
  color: string;
  zoneLabel: string;
  sent: boolean;
  assignedHomes: number;
  workedHomes: number;
  conversations: number;
  leads: number;
  appointments: number;
  remainingHomes: number;
  dueAt: string | null;
};

type DemoColorMode = 'zones' | 'allGreen' | 'random';
type AssignmentEditorSelectionTool = 'click' | 'lasso';
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
type AssignmentLiveDemoSnapshot = {
  colorOverrides: Record<string, string>;
  routes: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  reps: GeoJSON.FeatureCollection<GeoJSON.Point>;
  hitHomeCount: number;
  totalHomes: number;
};
type AssignmentDemoControl = {
  disabled?: boolean;
  hitHomes: number;
  isPlaying: boolean;
  onToggle: () => void;
  totalHomes: number;
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

function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pointCoordsFromGeometry(value: unknown): { lat: number; lon: number } | null {
  if (!value) return null;

  let geometry = value;
  if (typeof geometry === 'string') {
    const trimmed = geometry.trim();
    const wktMatch = trimmed.match(/^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i);
    if (wktMatch) {
      const lon = finiteNumber(wktMatch[1]);
      const lat = finiteNumber(wktMatch[2]);
      return lon === null || lat === null ? null : { lat, lon };
    }

    if (!trimmed.startsWith('{')) return null;
    try {
      geometry = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (typeof geometry !== 'object') return null;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'Point' || !Array.isArray(candidate.coordinates)) return null;
  const lon = finiteNumber(candidate.coordinates[0]);
  const lat = finiteNumber(candidate.coordinates[1]);
  return lon === null || lat === null ? null : { lat, lon };
}

function getAddressCoords(address: CampaignAddress): { lat: number; lon: number } | null {
  const coordinate = address.coordinate;
  if (coordinate) {
    const lat = finiteNumber(coordinate.lat);
    const lon = finiteNumber(coordinate.lon);
    if (lat !== null && lon !== null) return { lat, lon };
  }

  const addressWithGeometry = address as CampaignAddress & { geom_json?: unknown; geometry?: unknown };
  const geomJsonCoords = pointCoordsFromGeometry(addressWithGeometry.geom_json);
  if (geomJsonCoords) return geomJsonCoords;

  const geometryCoords = pointCoordsFromGeometry(addressWithGeometry.geometry);
  if (geometryCoords) return geometryCoords;

  const geomCoords = pointCoordsFromGeometry(address.geom);
  if (geomCoords) return geomCoords;

  const rawGeomJson = addressWithGeometry.geom_json as { coordinates?: unknown } | null;
  if (Array.isArray(rawGeomJson?.coordinates)) {
    const lon = finiteNumber(rawGeomJson.coordinates[0]);
    const lat = finiteNumber(rawGeomJson.coordinates[1]);
    if (lat !== null && lon !== null) return { lat, lon };
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

function getCampaignAddressStatus(address?: CampaignAddress | null): string {
  return String(address?.address_status ?? '').trim().toLowerCase();
}

function didWorkCampaignAddress(address?: CampaignAddress | null): boolean {
  if (!address) return false;
  if (address.visited) return true;
  return [
    'delivered',
    'talked',
    'lead',
    'interested',
    'appointment',
    'follow_up',
    'appointment_set',
    'callback_requested',
    'do_not_knock',
    'future_seller',
    'hot_lead',
    'no_answer',
    'not_home',
  ].includes(getCampaignAddressStatus(address));
}

function didHaveConversation(address?: CampaignAddress | null): boolean {
  return [
    'talked',
    'lead',
    'interested',
    'appointment',
    'follow_up',
    'appointment_set',
    'callback_requested',
    'future_seller',
    'hot_lead',
  ].includes(getCampaignAddressStatus(address));
}

function didCreateLead(address?: CampaignAddress | null): boolean {
  return [
    'lead',
    'interested',
    'appointment',
    'follow_up',
    'appointment_set',
    'callback_requested',
    'future_seller',
    'hot_lead',
  ].includes(getCampaignAddressStatus(address));
}

function didSetAppointment(address?: CampaignAddress | null): boolean {
  return ['appointment', 'appointment_set'].includes(getCampaignAddressStatus(address));
}

function formatAssignmentPercent(value: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

function campaignAddressLabel(address: AssignmentAddress | CampaignAddress): string {
  return address.formatted || address.street_name || ('address' in address ? address.address : '') || address.id.slice(0, 8);
}

function buildZoneLabelFeatureCollection(
  members: ZonePreviewMember[],
  zones: Map<string, AssignmentAddress[]>
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features = members.flatMap((member, index) => {
    const zoneHomes = (zones.get(member.user_id) ?? []).filter((address) => {
      return Number.isFinite(address.lon) && Number.isFinite(address.lat) && !(address.lon === 0 && address.lat === 0);
    });
    if (zoneHomes.length === 0) return [];

    const center = zoneHomes.reduce(
      (sum, address) => ({
        lon: sum.lon + address.lon / zoneHomes.length,
        lat: sum.lat + address.lat / zoneHomes.length,
      }),
      { lon: 0, lat: 0 }
    );

    return [{
      type: 'Feature' as const,
      id: member.user_id,
      properties: {
        user_id: member.user_id,
        display_name: member.display_name,
        homes: zoneHomes.length,
        label: `${member.display_name}\n${zoneHomes.length} homes`,
        color: member.color,
        zone: `Zone ${index + 1}`,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [center.lon, center.lat],
      },
    }];
  });

  return { type: 'FeatureCollection', features };
}

function syncMapSize(map: mapboxgl.Map) {
  try {
    map.resize();
  } catch {
    // Ignore transient resize errors while the dialog is opening or closing.
  }
}

function hasUsableMapContainerSize(container: HTMLElement | null) {
  if (!container) return false;
  const rect = container.getBoundingClientRect();
  return rect.width >= 80 && rect.height >= 80;
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

function orderedAssignmentHomes(addresses: AssignmentAddress[]) {
  return [...addresses]
    .filter((address) => Number.isFinite(address.lon) && Number.isFinite(address.lat) && !(address.lon === 0 && address.lat === 0))
    .sort((left, right) => {
      const leftStreet = demoStreetLabel(left).toLowerCase();
      const rightStreet = demoStreetLabel(right).toLowerCase();
      if (leftStreet !== rightStreet) return leftStreet.localeCompare(rightStreet);
      const leftNumber = demoHouseNumber(left);
      const rightNumber = demoHouseNumber(right);
      if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return leftNumber - rightNumber;
      return left.sequence - right.sequence;
    });
}

function setMapGeoJsonSource<T extends GeoJSON.Geometry>(
  map: mapboxgl.Map,
  sourceId: string,
  data: GeoJSON.FeatureCollection<T>
) {
  const existing = map.getSource(sourceId);
  if (existing && 'setData' in existing) {
    (existing as mapboxgl.GeoJSONSource).setData(data);
    return;
  }
  if (!existing) {
    map.addSource(sourceId, { type: 'geojson', data });
  }
}

function removeAssignmentLiveDemoLayers(map: mapboxgl.Map) {
  [
    ASSIGNMENT_LIVE_DEMO_REP_LABEL_LAYER_ID,
    ASSIGNMENT_LIVE_DEMO_REP_LAYER_ID,
    ASSIGNMENT_LIVE_DEMO_ROUTE_LAYER_ID,
  ].forEach((layerId) => {
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    } catch {
      // Ignore transient style changes while the map is reloading.
    }
  });

  [
    ASSIGNMENT_LIVE_DEMO_REP_SOURCE_ID,
    ASSIGNMENT_LIVE_DEMO_ROUTE_SOURCE_ID,
  ].forEach((sourceId) => {
    try {
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch {
      // Ignore transient style changes while the map is reloading.
    }
  });
}

function buildAssignmentLiveDemoSnapshot(
  members: ZonePreviewMember[],
  zones: Map<string, AssignmentAddress[]>,
  elapsedMs: number
): AssignmentLiveDemoSnapshot {
  const colorOverrides: Record<string, string> = {};
  const routeFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  const repFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const homeIntervalMs = 520;
  const memberStaggerMs = 700;
  let hitHomes = 0;
  let totalHomes = 0;

  members.forEach((member, memberIndex) => {
    const homes = orderedAssignmentHomes(zones.get(member.user_id) ?? []);
    if (homes.length === 0) return;

    totalHomes += homes.length;
    homes.forEach((home) => {
      colorOverrides[home.id] = member.color;
    });

    const rawStep = Math.max(0, Math.floor((elapsedMs - memberIndex * memberStaggerMs) / homeIntervalMs));
    const hitCount = Math.min(homes.length, rawStep);
    const activeIndex = Math.min(Math.max(0, hitCount), homes.length - 1);
    const activeHome = homes[activeIndex];
    const visitedHomes = homes.slice(0, hitCount);
    const routeHomes = homes.slice(0, Math.max(1, activeIndex + 1));
    const routeCoordinates = routeHomes.map((home) => [home.lon, home.lat] as [number, number]);

    hitHomes += hitCount;
    visitedHomes.forEach((home) => {
      colorOverrides[home.id] = DEMO_GREEN_COLOR;
    });

    routeFeatures.push({
      type: 'Feature',
      id: `${member.user_id}-route`,
      properties: {
        user_id: member.user_id,
        display_name: member.display_name,
        color: member.color,
      },
      geometry: {
        type: 'LineString',
        coordinates:
          routeCoordinates.length > 1
            ? routeCoordinates
            : [routeCoordinates[0], routeCoordinates[0]],
      },
    });

    repFeatures.push({
      type: 'Feature',
      id: member.user_id,
      properties: {
        user_id: member.user_id,
        display_name: member.display_name,
        color: member.color,
        hitHomes: hitCount,
        totalHomes: homes.length,
      },
      geometry: {
        type: 'Point',
        coordinates: [activeHome.lon, activeHome.lat],
      },
    });
  });

  return {
    colorOverrides,
    routes: { type: 'FeatureCollection', features: routeFeatures },
    reps: { type: 'FeatureCollection', features: repFeatures },
    hitHomeCount: hitHomes,
    totalHomes,
  };
}

function useAssignmentLiveCampaignDemo({
  mapRef,
  mapLoaded,
  members,
  zones,
  previewPoints,
  enabled,
}: {
  mapRef: RefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
  members: ZonePreviewMember[];
  zones: Map<string, AssignmentAddress[]>;
  previewPoints: ZonePreviewPoint[];
  enabled: boolean;
}) {
  const [snapshot, setSnapshot] = useState<AssignmentLiveDemoSnapshot | null>(null);
  const frameRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const lastSnapshotAtRef = useRef(0);
  const cycleDurationMs = useMemo(() => {
    const longestZone = Math.max(1, ...members.map((member) => (zones.get(member.user_id) ?? []).length));
    return longestZone * 520 + members.length * 700 + 2600;
  }, [members, zones]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    startedAtRef.current = null;
    lastSnapshotAtRef.current = 0;
    setSnapshot(null);
    const map = mapRef.current;
    if (map) removeAssignmentLiveDemoLayers(map);
  }, [mapRef]);

  const play = useCallback(() => {
    const map = mapRef.current;
    if (!enabled || !map || !mapLoaded || members.length === 0) return;

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (previewPoints.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      previewPoints.forEach((point) => bounds.extend([point.lon, point.lat]));
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: { top: 72, right: 72, bottom: 92, left: 72 },
          maxZoom: 17.4,
          bearing: map.getBearing(),
          pitch: map.getPitch(),
          duration: 600,
        });
      }
    }

    startedAtRef.current = performance.now();
    lastSnapshotAtRef.current = 0;
    const animate = (now: number) => {
      const startedAt = startedAtRef.current ?? now;
      const elapsed = (now - startedAt) % cycleDurationMs;
      if (lastSnapshotAtRef.current === 0 || now - lastSnapshotAtRef.current >= 140) {
        lastSnapshotAtRef.current = now;
        setSnapshot(buildAssignmentLiveDemoSnapshot(members, zones, elapsed));
      }
      frameRef.current = window.requestAnimationFrame(animate);
    };
    frameRef.current = window.requestAnimationFrame(animate);
  }, [cycleDurationMs, enabled, mapLoaded, mapRef, members, previewPoints, zones]);

  useEffect(() => {
    if (enabled) return;
    stop();
  }, [enabled, stop]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !snapshot) return;

    const addOrUpdateLayers = () => {
      if (!map.isStyleLoaded()) return;
      try {
        setMapGeoJsonSource(map, ASSIGNMENT_LIVE_DEMO_ROUTE_SOURCE_ID, snapshot.routes);
        setMapGeoJsonSource(map, ASSIGNMENT_LIVE_DEMO_REP_SOURCE_ID, snapshot.reps);

        if (!map.getLayer(ASSIGNMENT_LIVE_DEMO_ROUTE_LAYER_ID)) {
          map.addLayer({
            id: ASSIGNMENT_LIVE_DEMO_ROUTE_LAYER_ID,
            type: 'line',
            source: ASSIGNMENT_LIVE_DEMO_ROUTE_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
              'line-opacity': 0.78,
              'line-dasharray': [0.6, 1.2],
            },
          });
        }

        if (!map.getLayer(ASSIGNMENT_LIVE_DEMO_REP_LAYER_ID)) {
          map.addLayer({
            id: ASSIGNMENT_LIVE_DEMO_REP_LAYER_ID,
            type: 'circle',
            source: ASSIGNMENT_LIVE_DEMO_REP_SOURCE_ID,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 12],
              'circle-color': ['get', 'color'],
              'circle-opacity': 0.98,
              'circle-stroke-width': 3,
              'circle-stroke-color': '#ffffff',
            },
          });
        }

        if (!map.getLayer(ASSIGNMENT_LIVE_DEMO_REP_LABEL_LAYER_ID)) {
          map.addLayer({
            id: ASSIGNMENT_LIVE_DEMO_REP_LABEL_LAYER_ID,
            type: 'symbol',
            source: ASSIGNMENT_LIVE_DEMO_REP_SOURCE_ID,
            layout: {
              'text-field': ['get', 'display_name'],
              'text-size': 12,
              'text-offset': [0, 1.45],
              'text-anchor': 'top',
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': '#111827',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.4,
            },
          });
        }
      } catch (error) {
        console.error('Assignment live demo layers:', error);
      }
    };

    addOrUpdateLayers();
    map.on('style.load', addOrUpdateLayers);
    return () => {
      map.off('style.load', addOrUpdateLayers);
    };
  }, [mapLoaded, mapRef, snapshot]);

  return {
    colorOverrides: snapshot?.colorOverrides ?? null,
    hitHomes: snapshot?.hitHomeCount ?? 0,
    isPlaying: snapshot !== null,
    play,
    stop,
    totalHomes: snapshot?.totalHomes ?? members.reduce((sum, member) => sum + (zones.get(member.user_id) ?? []).length, 0),
  };
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
  assignmentDemo,
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
  assignmentDemo?: AssignmentDemoControl;
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
          {assignmentDemo ? (
            <button
              type="button"
              onClick={assignmentDemo.onToggle}
              disabled={assignmentDemo.disabled}
              className={`mb-1.5 flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                assignmentDemo.isPlaying
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
              aria-pressed={assignmentDemo.isPlaying}
              title={assignmentDemo.isPlaying ? 'Stop assignment demo' : 'Run assignment demo'}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {assignmentDemo.isPlaying ? <Square className="h-3.5 w-3.5 shrink-0" /> : <Play className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{assignmentDemo.isPlaying ? 'Stop assignment' : 'Assignment demo'}</span>
              </span>
              <span className="shrink-0 text-[11px] opacity-70">
                {assignmentDemo.hitHomes}/{assignmentDemo.totalHomes}
              </span>
            </button>
          ) : null}
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
  liveDemoPlaybackToken,
  layout = 'inline',
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
  liveDemoEnabled?: boolean;
  liveDemoPlaybackToken?: number;
  layout?: 'inline' | 'hero';
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
  const [selectedZoneMemberId, setSelectedZoneMemberId] = useState<string | null>(null);
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
  const liveDemoControlsEnabled = movieMapControlsEnabled;
  const liveCampaignDemo = useAssignmentLiveCampaignDemo({
    mapRef,
    mapLoaded,
    members,
    zones,
    previewPoints,
    enabled: liveDemoControlsEnabled,
  });
  const assignmentMapColorOverrides = liveCampaignDemo.colorOverrides ?? demoCamera.demoColorByAddressId;
  const playLiveCampaignDemo = liveCampaignDemo.play;
  const stopDemoCameraPlayback = demoCamera.stopDemoCamera;
  const zoneLabelFeatures = useMemo(
    () => buildZoneLabelFeatureCollection(members, zones),
    [members, zones]
  );
  const previewAddresses = useMemo(
    () => buildAssignmentPreviewAddresses(addressById, assignmentAddresses, zones, members),
    [addressById, assignmentAddresses, members, zones]
  );
  const selectedZoneMember = selectedZoneMemberId
    ? members.find((member) => member.user_id === selectedZoneMemberId) ?? null
    : null;
  const selectedZoneAddresses = selectedZoneMember ? zones.get(selectedZoneMember.user_id) ?? [] : [];

  const initialPoint = previewPoints[0] ?? null;
  const initialLon = initialPoint?.lon ?? null;
  const initialLat = initialPoint?.lat ?? null;
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
      map.easeTo({
        center: [previewPoints[0].lon, previewPoints[0].lat],
        zoom: 17,
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        duration: 450,
      });
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    previewPoints.forEach((point) => bounds.extend([point.lon, point.lat]));
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 44, right: 44, bottom: 44, left: 44 },
        maxZoom: 17,
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        duration: 450,
      });
    }
  }, [mapLoaded, previewPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const addOrUpdateZoneLabels = () => {
      if (!map.isStyleLoaded()) return;
      try {
        setMapGeoJsonSource(map, ASSIGNMENT_ZONE_LABEL_SOURCE_ID, zoneLabelFeatures);

        if (!map.getLayer(ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID)) {
          map.addLayer({
            id: ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID,
            type: 'circle',
            source: ASSIGNMENT_ZONE_LABEL_SOURCE_ID,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 18, 16, 28],
              'circle-color': ['get', 'color'],
              'circle-opacity': 0.92,
              'circle-stroke-width': 3,
              'circle-stroke-color': '#ffffff',
            },
          });
        }

        if (!map.getLayer(ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID)) {
          map.addLayer({
            id: ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID,
            type: 'symbol',
            source: ASSIGNMENT_ZONE_LABEL_SOURCE_ID,
            layout: {
              'text-field': ['get', 'label'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 13],
              'text-line-height': 1.08,
              'text-anchor': 'center',
              'text-allow-overlap': true,
            },
            paint: {
              'text-color': '#111827',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.3,
            },
          });
        }
      } catch (error) {
        console.error('Assignment zone labels:', error);
      }
    };

    const handleClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const userId = event.features?.[0]?.properties?.user_id;
      if (typeof userId === 'string') setSelectedZoneMemberId(userId);
    };
    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    addOrUpdateZoneLabels();
    map.on('style.load', addOrUpdateZoneLabels);
    map.on('click', ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID, handleClick);
    map.on('click', ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID, handleClick);
    map.on('mouseenter', ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID, handleMouseEnter);
    map.on('mouseenter', ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID, handleMouseEnter);
    map.on('mouseleave', ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID, handleMouseLeave);
    map.on('mouseleave', ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID, handleMouseLeave);

    return () => {
      try {
        map.off('style.load', addOrUpdateZoneLabels);
        if (map.getLayer(ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID)) {
          map.off('click', ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID, handleClick);
          map.off('mouseenter', ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID, handleMouseEnter);
          map.off('mouseleave', ASSIGNMENT_ZONE_LABEL_CIRCLE_LAYER_ID, handleMouseLeave);
        }
        if (map.getLayer(ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID)) {
          map.off('click', ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID, handleClick);
          map.off('mouseenter', ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID, handleMouseEnter);
          map.off('mouseleave', ASSIGNMENT_ZONE_LABEL_TEXT_LAYER_ID, handleMouseLeave);
        }
      } catch {
        // Mapbox can be mid-style teardown when the roster changes.
      }
    };
  }, [mapLoaded, zoneLabelFeatures]);

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

  useEffect(() => {
    if (!liveDemoControlsEnabled || !liveDemoPlaybackToken || !mapLoaded) return;
    stopDemoCameraPlayback();
    playLiveCampaignDemo();
  }, [liveDemoControlsEnabled, liveDemoPlaybackToken, mapLoaded, playLiveCampaignDemo, stopDemoCameraPlayback]);

  const assignmentDemoControl: AssignmentDemoControl | undefined = liveDemoControlsEnabled
    ? {
        disabled: !mapLoaded,
        hitHomes: liveCampaignDemo.hitHomes,
        isPlaying: liveCampaignDemo.isPlaying,
        onToggle: () => {
          if (liveCampaignDemo.isPlaying) {
            liveCampaignDemo.stop();
            return;
          }
          demoCamera.stopDemoCamera();
          liveCampaignDemo.play();
        },
        totalHomes: liveCampaignDemo.totalHomes,
      }
    : undefined;

  if (previewPoints.length === 0) {
    return null;
  }

  const openEditor = () => {
    if (!expandedOpen) {
      setEditorOpen(true);
      return;
    }

    setExpandedOpen(false);
    window.requestAnimationFrame(() => {
      setEditorOpen(true);
    });
  };

  const wrapperClassName = expandedOpen
    ? 'fixed inset-0 z-[70] grid h-[100dvh] w-[100vw] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-none border-0 bg-background'
    : layout === 'hero'
      ? 'grid h-full min-h-[560px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-muted/20'
      : 'overflow-hidden rounded-lg border border-border bg-muted/20';
  const mapFrameClassName = expandedOpen
    ? 'relative h-full min-h-0 w-full'
    : layout === 'hero'
      ? 'relative h-full min-h-[520px] w-full'
      : 'relative h-[360px] min-h-[320px] w-full';

  return (
    <div className={wrapperClassName} data-self-serve-demo-allow="true">
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
            <Button type="button" variant="secondary" size="sm" onClick={openEditor}>
              <Pencil className="h-3.5 w-3.5" />
              Edit map
            </Button>
          ) : null}
          {members.map((member) => (
            <span key={member.user_id} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full border border-border" style={{ backgroundColor: member.color }} />
              <span className="max-w-[140px] truncate">{member.display_name}</span>
            </span>
          ))}
        </div>
      </div>
      <div className={mapFrameClassName}>
        <div ref={mapContainerRef} className="h-full w-full" />
        {mapRef.current && mapLoaded ? (
          <>
            <MapBuildingsLayer
              map={mapRef.current}
              campaignId={campaignId}
              addressStateOverrides={previewAddresses}
              assignmentColorByAddressId={assignmentMapColorOverrides}
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
          assignmentDemo={assignmentDemoControl}
          demoCameraSpeed={demoCamera.demoCameraSpeed}
          demoColorMode={demoCamera.demoColorMode}
          demoSegmentCameraAngle={demoCamera.demoSegmentCameraAngle}
          disabled={!mapLoaded}
          enabled={movieMapControlsEnabled}
          onColorModeChange={demoCamera.handleDemoColorModeChange}
          onPlayShot={(shot) => {
            if (!liveCampaignDemo.isPlaying) {
              demoCamera.stopDemoCamera();
              liveCampaignDemo.play();
            }
            demoCamera.playDemoCamera(shot);
          }}
          onSegmentCameraAngleChange={demoCamera.setDemoSegmentCameraAngle}
          onSpeedChange={demoCamera.setDemoCameraSpeed}
          onStop={demoCamera.stopDemoCamera}
          setShowDemoControls={demoCamera.setShowDemoControls}
          showDemoControls={demoCamera.showDemoControls}
        />
        {liveCampaignDemo.isPlaying ? (
          <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-lg border border-white/70 bg-white/92 px-3 py-2 text-xs font-medium text-gray-900 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-black/82 dark:text-white">
            {liveCampaignDemo.hitHomes}/{liveCampaignDemo.totalHomes} homes green
          </div>
        ) : null}
        {selectedZoneMember ? (
          <div className="absolute bottom-3 left-3 z-20 max-h-[min(300px,calc(100%-1.5rem))] w-[min(360px,calc(100%-1.5rem))] overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur">
            <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{selectedZoneMember.display_name}</p>
                <p className="text-xs text-muted-foreground">{selectedZoneAddresses.length} homes assigned</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedZoneMemberId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="max-h-56 overflow-y-auto px-3 py-2">
              {selectedZoneAddresses.slice(0, 24).map((address, index) => (
                <div key={address.id} className="flex items-start gap-2 py-1.5 text-xs">
                  <span className="mt-0.5 w-5 shrink-0 text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 truncate">{campaignAddressLabel(address)}</span>
                </div>
              ))}
              {selectedZoneAddresses.length > 24 ? (
                <p className="py-1 text-xs text-muted-foreground">
                  +{selectedZoneAddresses.length - 24} more homes
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
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
  const editorMapFittedRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [buildingRenderState, setBuildingRenderState] = useState<MapBuildingsRenderState | null>(null);
  const [selectedAddressIds, setSelectedAddressIds] = useState<string[]>([]);
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string>>({});
  const [activeMemberId, setActiveMemberId] = useState<string>('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectionTool, setSelectionTool] = useState<AssignmentEditorSelectionTool>('click');
  const lassoCoordinatesRef = useRef<[number, number][]>([]);

  useEffect(() => {
    if (!open) return;
    setSelectedAddressIds([]);
    setDraftOverrides(appliedManualOverrides);
    setSelectMode(editable);
    setSelectionTool('click');
    editorMapFittedRef.current = false;
    setActiveMemberId((current) =>
      current && memberIds.includes(current) ? current : memberIds[0] ?? ''
    );
  }, [appliedManualOverrides, editable, memberIds, open]);

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
  const editorVisible = open && previewPoints.length > 0;
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
  const hasRenderableAssignmentMap = Boolean(mapLoaded || buildingRenderState?.hasVisibleFeatures);
  const showMapError = Boolean(mapError && !hasRenderableAssignmentMap);
  const showMissingCoordinateMessage = open && assignmentAddresses.length > 0 && previewPoints.length === 0;

  useEffect(() => {
    if (buildingRenderState?.hasVisibleFeatures) {
      setMapError(null);
    }
  }, [buildingRenderState?.hasVisibleFeatures]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!editorVisible || !container || initialLon === null || initialLat === null) return;

    const token = getMapboxToken();
    if (!token) {
      setMapError('Mapbox token not configured.');
      return;
    }

    let cancelled = false;
    let sizeRetryId: number | null = null;
    const resizeTimerIds: number[] = [];
    setMapError(null);
    setMapLoaded(false);
    mapboxgl.accessToken = token;

    void getResolvedMapInitOptions(resolvedMapStyle)
      .then((initOptions) => {
        const scheduleMapResize = (map: mapboxgl.Map) => {
          [0, 50, 150, 300, 600].forEach((delay) => {
            const timerId = window.setTimeout(() => {
              if (!cancelled && mapRef.current === map) syncMapSize(map);
            }, delay);
            resizeTimerIds.push(timerId);
          });
        };

        const createEditorMap = (attempt = 0) => {
          if (cancelled) return;
          const currentContainer = mapContainerRef.current;
          if (!currentContainer) return;
          if (!hasUsableMapContainerSize(currentContainer)) {
            if (attempt === 20) {
              setMapError('Map is still loading.');
            }
            sizeRetryId = window.setTimeout(() => createEditorMap(attempt + 1), attempt < 20 ? 50 : 120);
            return;
          }

          setMapError(null);
          const map = new mapboxgl.Map({
            container: currentContainer,
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
          scheduleMapResize(map);

          const handleMapReady = () => {
            applyPresetVisualTweaks(map, resolvedMapStyle, {
              preserveLayerPrefixes: ['map-buildings-', 'campaign-', 'flyr-'],
            });
            syncMapSize(map);
            scheduleMapResize(map);
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
            handleMapReady();
            setMapLoaded(true);
            setMapError(null);
            window.requestAnimationFrame(() => syncMapSize(map));
          });
          map.on('idle', () => {
            if (!cancelled && mapRef.current === map) syncMapSize(map);
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

          const cleanupMapEvents = () => {
            map.off('style.load', handleStyleLoad);
          };
          map.once('remove', cleanupMapEvents);
          if (map.isStyleLoaded()) {
            handleStyleLoad();
          } else {
            window.setTimeout(() => {
              if (!cancelled && mapRef.current === map && map.isStyleLoaded()) {
                handleStyleLoad();
              }
            }, 0);
          }
        };

        if (cancelled || !mapContainerRef.current) return;
        createEditorMap();
      })
      .catch(() => {
        if (!cancelled) setMapError('Map unavailable.');
      });

    return () => {
      cancelled = true;
      if (sizeRetryId !== null) window.clearTimeout(sizeRetryId);
      resizeTimerIds.forEach((timerId) => window.clearTimeout(timerId));
      setMapLoaded(false);
      if (mapRef.current) {
        removeMapboxMapWhenSafe(mapRef.current);
        mapRef.current = null;
      }
    };
  }, [editorVisible, initialLat, initialLon, resolvedMapStyle]);

  useEffect(() => {
    if (!showMissingCoordinateMessage) return;
    setMapLoaded(false);
    setMapError('No mappable homes found for this assignment.');
  }, [showMissingCoordinateMessage]);

  useEffect(() => {
    if (!editorVisible) return;

    const map = mapRef.current;
    if (!map) return;

    const timerIds = [0, 80, 180, 360, 700].map((delay) =>
      window.setTimeout(() => {
        syncMapSize(map);
      }, delay)
    );

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [editorVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || previewPoints.length === 0) return;
    if (editorMapFittedRef.current) return;
    editorMapFittedRef.current = true;
    syncMapSize(map);

    if (previewPoints.length === 1) {
      map.easeTo({ center: [previewPoints[0].lon, previewPoints[0].lat], zoom: 17, pitch: 45, duration: 450 });
      window.setTimeout(() => syncMapSize(map), 500);
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
      window.setTimeout(() => syncMapSize(map), 500);
    }
  }, [mapLoaded, previewPoints]);

  useEffect(() => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!editorVisible || !map || !container || !mapLoaded) return;

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
  }, [editorVisible, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!editable || !selectMode || selectionTool !== 'lasso' || !map) return;

    let drawing = false;
    let styleReady = false;
    const emptyData: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
      type: 'FeatureCollection',
      features: [],
    };

    const removeLassoLayers = () => {
      [ASSIGNMENT_LASSO_FILL_LAYER_ID, ASSIGNMENT_LASSO_LINE_LAYER_ID].forEach((layerId) => {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        } catch {
          // Ignore style swaps while closing the editor.
        }
      });
      try {
        if (map.getSource(ASSIGNMENT_LASSO_SOURCE_ID)) map.removeSource(ASSIGNMENT_LASSO_SOURCE_ID);
      } catch {
        // Ignore style swaps while closing the editor.
      }
    };

    const getLassoSource = () => {
      const source = map.getSource(ASSIGNMENT_LASSO_SOURCE_ID);
      return source && 'setData' in source ? source as mapboxgl.GeoJSONSource : null;
    };

    const lassoFeature = (coordinates: [number, number][]): GeoJSON.FeatureCollection<GeoJSON.Polygon> => {
      if (coordinates.length < 3) return emptyData;
      const ring = [...coordinates, coordinates[0]];
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [ring],
          },
        }],
      };
    };

    const syncLasso = () => {
      const source = getLassoSource();
      if (!source) return;
      source.setData(lassoFeature(lassoCoordinatesRef.current));
    };

    const ensureLassoLayers = () => {
      if (!map.isStyleLoaded()) return;
      styleReady = true;
      if (!map.getSource(ASSIGNMENT_LASSO_SOURCE_ID)) {
        map.addSource(ASSIGNMENT_LASSO_SOURCE_ID, { type: 'geojson', data: emptyData });
      }
      if (!map.getLayer(ASSIGNMENT_LASSO_FILL_LAYER_ID)) {
        map.addLayer({
          id: ASSIGNMENT_LASSO_FILL_LAYER_ID,
          type: 'fill',
          source: ASSIGNMENT_LASSO_SOURCE_ID,
          paint: {
            'fill-color': '#111111',
            'fill-opacity': 0.16,
          },
        });
      }
      if (!map.getLayer(ASSIGNMENT_LASSO_LINE_LAYER_ID)) {
        map.addLayer({
          id: ASSIGNMENT_LASSO_LINE_LAYER_ID,
          type: 'line',
          source: ASSIGNMENT_LASSO_SOURCE_ID,
          paint: {
            'line-color': '#111111',
            'line-width': 2.5,
            'line-opacity': 0.9,
          },
        });
      }
    };

    const finishLasso = () => {
      if (!drawing) return;
      drawing = false;
      map.dragPan.enable();
      map.getCanvas().style.cursor = 'crosshair';
      const featureCollection = lassoFeature(lassoCoordinatesRef.current);
      const lassoSelectedIds = selectedAddressIdsFromFeatures(featureCollection.features, assignmentAddresses);
      lassoCoordinatesRef.current = [];
      getLassoSource()?.setData(emptyData);
      if (lassoSelectedIds.length === 0) return;
      setSelectedAddressIds((current) => Array.from(new Set([...current, ...lassoSelectedIds])));
    };

    const handleMouseDown = (event: mapboxgl.MapMouseEvent) => {
      const originalEvent = event.originalEvent as MouseEvent | undefined;
      if (originalEvent && originalEvent.button !== 0) return;
      event.preventDefault();
      ensureLassoLayers();
      if (!styleReady) return;
      drawing = true;
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'crosshair';
      lassoCoordinatesRef.current = [[event.lngLat.lng, event.lngLat.lat]];
      syncLasso();
    };

    const handleMouseMove = (event: mapboxgl.MapMouseEvent) => {
      if (!drawing) return;
      lassoCoordinatesRef.current = [
        ...lassoCoordinatesRef.current,
        [event.lngLat.lng, event.lngLat.lat],
      ];
      syncLasso();
    };

    const handleMouseUp = () => {
      finishLasso();
    };

    ensureLassoLayers();
    map.getCanvas().style.cursor = 'crosshair';
    map.on('style.load', ensureLassoLayers);
    map.on('mousedown', handleMouseDown);
    map.on('mousemove', handleMouseMove);
    map.on('mouseup', handleMouseUp);

    return () => {
      finishLasso();
      map.off('style.load', ensureLassoLayers);
      map.off('mousedown', handleMouseDown);
      map.off('mousemove', handleMouseMove);
      map.off('mouseup', handleMouseUp);
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
      lassoCoordinatesRef.current = [];
      removeLassoLayers();
    };
  }, [assignmentAddresses, editable, selectMode, selectionTool]);

  const clearSelection = () => {
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
    setSelectedAddressIds([]);
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
    addressId?: string
  ) => {
    if (!selectMode) return;
    if (selectionTool !== 'click') return;
    if (!addressId || !assignmentAddressIdSet.has(addressId)) return;
    setSelectedAddressIds((current) => {
      const exists = current.includes(addressId);
      return exists ? current.filter((id) => id !== addressId) : [...current, addressId];
    });
  }, [assignmentAddressIdSet, selectMode, selectionTool]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="left-0 top-0 grid h-[100dvh] w-[100vw] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        data-self-serve-demo-allow="true"
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
        </div>

        <div className="relative h-full min-h-[360px] w-full overflow-hidden">
          <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />
          {editable ? (
            <div className="absolute left-4 top-4 z-10 max-h-[calc(100%-2rem)] w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
              <div className="space-y-4">
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 1</p>
                      <p className="text-sm font-semibold">Select houses</p>
                    </div>
                    <Badge variant={selectedAddressIds.length > 0 ? 'default' : 'secondary'}>
                      {selectedAddressIds.length} selected
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={selectMode && selectionTool === 'click' ? 'default' : 'outline'}
                      aria-pressed={selectMode && selectionTool === 'click'}
                      onClick={() => {
                        setSelectMode(true);
                        setSelectionTool('click');
                      }}
                    >
                      <MousePointer2 className="h-4 w-4" />
                      Click
                    </Button>
                    <Button
                      type="button"
                      variant={selectMode && selectionTool === 'lasso' ? 'default' : 'outline'}
                      aria-pressed={selectMode && selectionTool === 'lasso'}
                      onClick={() => {
                        setSelectMode(true);
                        setSelectionTool('lasso');
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      Lasso
                    </Button>
                  </div>
                </section>

                <section className="space-y-2 border-t border-border pt-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 2</p>
                    <Label>Assign to member</Label>
                  </div>
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
                              ? 'border-foreground bg-foreground text-background'
                              : 'border-border bg-background/70 text-muted-foreground hover:bg-background'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: member.color }} />
                            <span className="truncate text-sm font-medium">{member.display_name}</span>
                          </span>
                          <span className="shrink-0 text-xs">
                            {zoneHomes.length} / {manualCount} edited
                          </span>
                        </button>
                      );
                    })}
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
                </section>

                <Button type="button" variant="outline" className="w-full" onClick={resetEdits}>
                  <RotateCcw className="h-4 w-4" />
                  Reset edits
                </Button>
              </div>
            </div>
          ) : null}
          {mapRef.current ? (
            <>
              <MapBuildingsLayer
                map={mapRef.current}
                campaignId={campaignId}
                addressStateOverrides={previewAddresses}
                assignmentColorByAddressId={assignmentColorByAddressId}
                selectedAddressIds={selectedAddressIds}
                visibleAddressIds={assignmentAddresses.map((address) => address.id)}
                showAddressLabels={false}
                footprintStatusColors
                isDarkMap={theme === 'dark'}
                selectionOnly={editable}
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

export function CampaignAssignmentView({
  campaignId,
  campaignName,
  addresses,
  demoMode = false,
  demoLivePlaybackToken = 0,
  onDemoSplitComplete,
}: CampaignAssignmentViewProps) {
  const { currentWorkspace, membershipsByWorkspaceId } = useWorkspace();
  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canManage = demoMode || currentRole === 'owner' || currentRole === 'admin';

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
  const [assignmentMapRevealed, setAssignmentMapRevealed] = useState(false);

  const assignmentAddresses = useMemo(() => toAssignmentAddresses(addresses), [addresses]);
  const autoZones = useMemo(
    () => buildZones(assignmentAddresses, selectedMemberIds, splitMode),
    [assignmentAddresses, selectedMemberIds, splitMode]
  );
  const zones = useMemo(
    () => applyManualOverridesToZones(autoZones, assignmentAddresses, selectedMemberIds, appliedManualOverrides),
    [appliedManualOverrides, assignmentAddresses, autoZones, selectedMemberIds]
  );
  const previewZones = useMemo(() => {
    if (mode === 'zone_split') return zones;

    const wholeTeamZones = new Map<string, AssignmentAddress[]>();
    if (selectedMemberIds[0]) wholeTeamZones.set(selectedMemberIds[0], assignmentAddresses);
    return wholeTeamZones;
  }, [assignmentAddresses, mode, selectedMemberIds, zones]);
  const assignmentMapKey = useMemo(
    () => [mode, splitMode, ...selectedMemberIds].join(':'),
    [mode, selectedMemberIds, splitMode]
  );

  const toggleSelectedMember = useCallback((memberId: string) => {
    const removingMember = selectedMemberIds.includes(memberId);
    if (removingMember) {
      setAppliedManualOverrides({});
    }
    setAssignmentMapRevealed(false);
    setSelectedMemberIds((current) => {
      if (removingMember) return current.filter((id) => id !== memberId);
      if (current.includes(memberId)) return current;
      return [...current, memberId];
    });
  }, [selectedMemberIds]);

  useEffect(() => {
    setAppliedManualOverrides((current) => {
      const next = sanitizeManualOverrides(current, assignmentAddresses, selectedMemberIds, autoZones);
      return shallowRecordEqual(current, next) ? current : next;
    });
  }, [assignmentAddresses, autoZones, selectedMemberIds]);

  const loadAssignments = useCallback(async () => {
    if (demoMode) {
      setAssignments([]);
      setLoading(false);
      return;
    }

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
  }, [campaignId, demoMode]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  useEffect(() => {
    if (demoMode) {
      setMembers(SELF_SERVE_DEMO_MEMBERS);
      setSelectedMemberIds(SELF_SERVE_DEMO_MEMBERS.map((member) => member.user_id));
      setLoading(false);
      return;
    }

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
  }, [canManage, currentWorkspaceId, demoMode]);

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
  const addressById = useMemo(() => new Map(addresses.map((address) => [address.id, address])), [addresses]);
  const assignmentReportRows = useMemo<AssignmentCampaignReportRow[]>(() => {
    const buildMetrics = (homes: CampaignAddress[]) => {
      const workedHomes = homes.filter(didWorkCampaignAddress).length;
      const conversations = homes.filter(didHaveConversation).length;
      const leads = homes.filter(didCreateLead).length;
      const appointments = homes.filter(didSetAppointment).length;
      return { workedHomes, conversations, leads, appointments };
    };

    if (assignments.length > 0) {
      return assignments.map((assignment, index) => {
        const assignmentHomes = (assignment.homes ?? [])
          .map((home) => addressById.get(home.campaign_address_id))
          .filter((address): address is CampaignAddress => Boolean(address));
        const scopedHomes = assignmentHomes.length > 0 || assignment.mode === 'zone_split' ? assignmentHomes : addresses;
        const assignedHomes = assignment.goal_homes || scopedHomes.length;
        const metrics = buildMetrics(scopedHomes);
        const selectedIndex = selectedMemberIds.indexOf(assignment.assigned_to_user_id);

        return {
          id: assignment.id,
          name: assignment.assignee?.display_name ?? assignment.assigned_to_user_id.slice(0, 8),
          color: COLORS[(selectedIndex >= 0 ? selectedIndex : index) % COLORS.length],
          zoneLabel: assignment.mode === 'zone_split' && assignment.zone_index !== null
            ? `Zone ${assignment.zone_index + 1}`
            : 'Shared map',
          sent: true,
          assignedHomes,
          workedHomes: metrics.workedHomes,
          conversations: metrics.conversations,
          leads: metrics.leads,
          appointments: metrics.appointments,
          remainingHomes: Math.max(0, assignedHomes - metrics.workedHomes),
          dueAt: assignment.due_at,
        };
      });
    }

    return selectedMembers.map((member, index) => {
      const zoneHomes = mode === 'zone_split' ? zones.get(member.user_id) ?? [] : assignmentAddresses;
      const campaignHomes = zoneHomes
        .map((address) => addressById.get(address.id))
        .filter((address): address is CampaignAddress => Boolean(address));
      const metrics = buildMetrics(campaignHomes);

      return {
        id: member.user_id,
        name: member.display_name,
        color: COLORS[index % COLORS.length],
        zoneLabel: mode === 'zone_split' ? `Zone ${index + 1}` : 'Shared map',
        sent: false,
        assignedHomes: zoneHomes.length,
        workedHomes: metrics.workedHomes,
        conversations: metrics.conversations,
        leads: metrics.leads,
        appointments: metrics.appointments,
        remainingHomes: Math.max(0, zoneHomes.length - metrics.workedHomes),
        dueAt: dueAt ? `${dueAt}T23:59:59` : null,
      };
    });
  }, [
    addressById,
    addresses,
    assignmentAddresses,
    assignments,
    dueAt,
    mode,
    selectedMemberIds,
    selectedMembers,
    zones,
  ]);
  const assignmentWasSent = assignments.length > 0;
  const assignmentReportTotalHomes = addresses.length;
  const assignmentReportWorkedHomes = addresses.filter(didWorkCampaignAddress).length;
  const assignmentReportAssignees = assignmentReportRows.map((row) => row.name).join(', ');

  const handleSave = useCallback(async () => {
    if (demoMode) {
      if (selectedMemberIds.length === 0) {
        setMessage('Select at least one demo member.');
        return;
      }
      if (mode === 'zone_split' && selectedMemberIds.length > assignmentAddresses.length) {
        setMessage('Not enough homes to give every demo member a zone.');
        return;
      }

      setSaving(true);
      setMessage(null);
      setWarnings([]);
      setAssignmentMapRevealed(false);
      window.setTimeout(() => {
        const nextAssignments: AssignmentRow[] = selectedMemberIds.map((memberId, index) => {
          const zoneHomes = mode === 'zone_split' ? zones.get(memberId) ?? [] : assignmentAddresses;
          const member = SELF_SERVE_DEMO_MEMBERS.find((candidate) => candidate.user_id === memberId);
          return {
            id: `demo-assignment-${memberId}`,
            assigned_to_user_id: memberId,
            mode,
            goal_homes: zoneHomes.length,
            zone_index: mode === 'zone_split' ? index : null,
            due_at: dueAt ? `${dueAt}T23:59:59` : null,
            notes: notes || 'Demo team route preview',
            assignee: { display_name: member?.display_name ?? memberId },
            homes: zoneHomes.map((address, sequence) => ({
              campaign_address_id: address.id,
              sequence,
            })),
          };
        });
        setAssignments(nextAssignments);
        setMessage('Assignment sent to demo reps.');
        setNotes('');
        setDueAt('');
        setAssignmentMapRevealed(true);
        setSaving(false);
        onDemoSplitComplete?.();
      }, 250);
      return;
    }

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
    setAssignmentMapRevealed(false);

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
      setMessage('Assignment sent to assignees.');
      setNotes('');
      setDueAt('');
      setAssignmentMapRevealed(true);
    } catch {
      setMessage('Failed to assign campaign.');
    } finally {
      setSaving(false);
    }
  }, [
    assignmentAddresses,
    campaignId,
    currentWorkspaceId,
    demoMode,
    dueAt,
    mode,
    notes,
    onDemoSplitComplete,
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
      <div className="grid min-h-[620px] gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col rounded-lg border border-border bg-background">
          <div className="border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Assign campaign</h2>
                <p className="text-sm text-muted-foreground">{addresses.length} homes</p>
              </div>
              <Users className="mt-1 h-5 w-5 text-muted-foreground" />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div className="space-y-2">
              <Label>Reps</Label>
              <div className="grid grid-cols-2 gap-2">
                {members.map((member, index) => {
                  const selected = selectedMemberIds.includes(member.user_id);
                  return (
                    <button
                      key={member.user_id}
                      type="button"
                      onClick={() => toggleSelectedMember(member.user_id)}
                      disabled={saving}
                      className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="truncate">{member.display_name}</span>
                      </span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Split</Label>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Split type">
                {[
                  { id: 'smart', label: 'Smart zones', active: mode === 'zone_split' && splitMode === 'smart' },
                  { id: 'balanced', label: 'Even split', active: mode === 'zone_split' && splitMode === 'balanced' },
                  { id: 'shared', label: 'Shared map', active: mode === 'whole_team' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={option.active}
                    onClick={() => {
                      if (option.id === 'shared') {
                        setMode('whole_team');
                        return;
                      }
                      setMode('zone_split');
                      setSplitMode(option.id === 'balanced' ? 'balanced' : 'smart');
                    }}
                    className={`flex min-h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                      option.active
                        ? 'border-foreground bg-muted/60 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full border ${option.active ? 'border-foreground bg-foreground' : 'border-muted-foreground'}`} />
                    <span className="truncate">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="campaign-assignment-due">Due date</Label>
              <Input
                id="campaign-assignment-due"
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="campaign-assignment-notes">Instructions</Label>
              <Textarea
                id="campaign-assignment-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional"
                rows={1}
                className="min-h-9 resize-none overflow-hidden py-1.5"
                disabled={saving}
              />
            </div>

            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
            {warnings.length > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {warnings.slice(0, 3).map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
          </div>

          <div className="border-t border-border p-4">
            <Button className="w-full" onClick={() => void handleSave()} disabled={saving || selectedMemberIds.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Assignment
            </Button>
          </div>
        </aside>

        <div className="min-h-[560px]">
	          {zonePreviewMembers.length > 0 ? (
	            <CampaignAssignmentZonePreviewMap
	              key={assignmentMapKey}
	              campaignId={campaignId}
              addresses={addresses}
              assignmentAddresses={assignmentAddresses}
              members={zonePreviewMembers}
              autoZones={autoZones}
              zones={previewZones}
              manualOverrides={appliedManualOverrides}
              showAssignmentColors={mode === 'zone_split'}
              editable={mode === 'zone_split'}
              layout="hero"
              onApplyManualOverrides={setAppliedManualOverrides}
              liveDemoEnabled={demoMode}
              liveDemoPlaybackToken={demoLivePlaybackToken || (assignmentMapRevealed ? 1 : 0)}
            />
          ) : (
            <div className="flex h-full min-h-[560px] items-center justify-center rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              Select at least one rep to preview assignment zones.
            </div>
          )}
        </div>
      </div>

      <section className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-base font-semibold">Assignment note</h3>
              <Badge variant={assignmentWasSent ? 'default' : 'secondary'}>
                {assignmentWasSent ? 'Sent' : 'Draft'}
              </Badge>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {assignmentWasSent
                ? `Sent ${campaignName ?? 'this campaign'} to ${assignmentReportAssignees || 'the selected assignees'}. Reporting below is scoped to this campaign assignment.`
                : `Draft preview for ${campaignName ?? 'this campaign'}. Send it to create assignee-specific reporting for this campaign.`}
            </p>
          </div>
          {assignmentWasSent ? (
            <Link href={`/campaigns/${campaignId}`} className="text-sm font-medium text-primary hover:underline">
              Open campaign
            </Link>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md bg-muted/35 px-3 py-2">
            <p className="text-xs text-muted-foreground">Assigned homes</p>
            <p className="text-lg font-semibold">{assignmentReportTotalHomes}</p>
          </div>
          <div className="rounded-md bg-muted/35 px-3 py-2">
            <p className="text-xs text-muted-foreground">Attempted homes</p>
            <p className="text-lg font-semibold">{assignmentReportWorkedHomes}</p>
          </div>
          <div className="rounded-md bg-muted/35 px-3 py-2">
            <p className="text-xs text-muted-foreground">Completion</p>
            <p className="text-lg font-semibold">{formatAssignmentPercent(assignmentReportWorkedHomes, assignmentReportTotalHomes)}</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[760px] overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[1.3fr_0.8fr_repeat(6,0.7fr)] gap-0 border-b border-border bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Assignee</span>
              <span>Zone</span>
              <span>Homes</span>
              <span>Attempted</span>
              <span>Talked</span>
              <span>Leads</span>
              <span>Appts</span>
              <span>Done</span>
            </div>
            {assignmentReportRows.length > 0 ? (
              assignmentReportRows.map((row) => (
                <div key={row.id} className="grid grid-cols-[1.3fr_0.8fr_repeat(6,0.7fr)] gap-0 border-b border-border px-3 py-2 text-sm last:border-b-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: row.color }} />
                    <span className="truncate">{row.name}</span>
                  </span>
                  <span className="text-muted-foreground">{row.zoneLabel}</span>
                  <span>{row.assignedHomes}</span>
                  <span>{row.workedHomes}</span>
                  <span>{row.conversations}</span>
                  <span>{row.leads}</span>
                  <span>{row.appointments}</span>
                  <span>{formatAssignmentPercent(row.workedHomes, row.assignedHomes)}</span>
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-sm text-muted-foreground">No assignees selected.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
