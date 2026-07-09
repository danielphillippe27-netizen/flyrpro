'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TerritoryDrawHint } from '@/components/territory/TerritoryCreateFlow';
import { getDrawnPolygon } from '@/lib/territory/create-polygon';
import {
  applyDrawModeForPhase,
  clearTerritoryDrawing,
  useTerritoryCreatePhase,
} from '@/lib/territory/use-territory-create-phase';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/theme-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getIndustryCopy } from '@/lib/industry-copy';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import {
  applyPresetVisualTweaks,
  applyResolvedMapStyle,
  hideBaseBuildingLayers,
  resolveMapStyle,
} from '@/lib/map-styles';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { UserLocationLayer } from '@/components/map/UserLocationLayer';
import { PaywallGuard } from '@/components/PaywallGuard';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';
import { CalendarDays, CircleAlert, Map, Minus, Pencil, Plus, Search, Satellite, Trash2, TriangleAlert, Users } from 'lucide-react';
import * as turf from '@turf/turf';
import Lottie from 'lottie-react';

const MAP_USABLE_PHASES = new Set(['map_ready', 'linker_ready', 'optimizing', 'optimized']);
const MAP_READY_TIMEOUT_MS = 5 * 60 * 1000;
const MAP_BUNDLE_TIMEOUT_MS = 45 * 1000;
const SELF_SERVE_CAMPAIGN_DRAFT_KEY = 'flyr.selfServeCampaignDraft';
const DEFAULT_SELF_SERVE_CAMPAIGN_NAME = 'FIRST CAMPAIGN';
const CAMPAIGN_OVERLAY_SOURCE_ID = 'campaign-territory-overlays';
const CAMPAIGN_OVERLAY_FILL_LAYER_ID = 'campaign-territory-overlays-fill';
const CAMPAIGN_OVERLAY_LINE_LAYER_ID = 'campaign-territory-overlays-line';
const CAMPAIGN_OVERLAY_LAYER_IDS = [CAMPAIGN_OVERLAY_FILL_LAYER_ID, CAMPAIGN_OVERLAY_LINE_LAYER_ID] as const;

type TeamMember = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member';
  is_current_user?: boolean;
};

type TerritoryOverlayCampaign = {
  id: string;
  name: string;
  status: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  bbox: [number, number, number, number] | null;
  assignees: string[];
  progress: {
    visited: number;
    total: number;
    percent: number;
  };
};

type TerritoryOverlaysPayload = {
  campaigns?: TerritoryOverlayCampaign[];
  error?: string;
};

function isWorkspaceCampaignLimitResponse(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as { code?: unknown; error?: unknown; message?: unknown };
  return (
    candidate.code === 'workspace_campaign_limit_reached' ||
    (typeof candidate.error === 'string' && candidate.error.includes('included campaign')) ||
    (typeof candidate.message === 'string' && candidate.message.includes('workspace_campaign_limit_reached'))
  );
}

type CreateCampaignDialogTone = 'default' | 'warning' | 'destructive';

type CreateCampaignDialogState = {
  title: string;
  description: string;
  tone: CreateCampaignDialogTone;
  actionLabel: string;
};

type SelfServeCampaignDraft = {
  name: string;
  polygon: GeoJSON.Polygon;
  bbox?: number[];
  referralCode?: string | null;
  createdAt: string;
};

type SelfServeLocationState = 'idle' | 'requesting' | 'centered' | 'prompt' | 'dismissed';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function removeCampaignOverlayLayers(mapInstance: mapboxgl.Map) {
  for (const layerId of CAMPAIGN_OVERLAY_LAYER_IDS) {
    if (mapInstance.getLayer(layerId)) {
      mapInstance.removeLayer(layerId);
    }
  }
}

function findFirstDrawLayerId(mapInstance: mapboxgl.Map): string | undefined {
  return mapInstance.getStyle().layers?.find((layer) => layer.id.startsWith('gl-draw-'))?.id;
}

function upsertCampaignOverlayLayers(
  mapInstance: mapboxgl.Map,
  featureCollection: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
) {
  removeCampaignOverlayLayers(mapInstance);

  const existingSource = mapInstance.getSource(CAMPAIGN_OVERLAY_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
  if (existingSource) {
    existingSource.setData(featureCollection);
  } else {
    mapInstance.addSource(CAMPAIGN_OVERLAY_SOURCE_ID, {
      type: 'geojson',
      data: featureCollection,
    });
  }

  const beforeLayerId = findFirstDrawLayerId(mapInstance);
  mapInstance.addLayer(
    {
      id: CAMPAIGN_OVERLAY_FILL_LAYER_ID,
      type: 'fill',
      source: CAMPAIGN_OVERLAY_SOURCE_ID,
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'status'], 'completed'],
          '#22c55e',
          ['==', ['get', 'status'], 'active'],
          '#3b82f6',
          '#64748b',
        ],
        'fill-opacity': 0.16,
      },
    },
    beforeLayerId,
  );
  mapInstance.addLayer(
    {
      id: CAMPAIGN_OVERLAY_LINE_LAYER_ID,
      type: 'line',
      source: CAMPAIGN_OVERLAY_SOURCE_ID,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'status'], 'completed'],
          '#16a34a',
          ['==', ['get', 'status'], 'active'],
          '#2563eb',
          '#475569',
        ],
        'line-opacity': 0.72,
        'line-width': 2,
      },
    },
    beforeLayerId,
  );
}

function removeCampaignOverlaySource(mapInstance: mapboxgl.Map) {
  removeCampaignOverlayLayers(mapInstance);
  if (mapInstance.getSource(CAMPAIGN_OVERLAY_SOURCE_ID)) {
    mapInstance.removeSource(CAMPAIGN_OVERLAY_SOURCE_ID);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBboxForPolygon(polygon: GeoJSON.Polygon): number[] | undefined {
  try {
    const turfPolygon = turf.polygon(polygon.coordinates);
    const calculatedBbox = turf.bbox(turfPolygon);
    return [calculatedBbox[0], calculatedBbox[1], calculatedBbox[2], calculatedBbox[3]];
  } catch (bboxError) {
    console.error('Error calculating bbox from polygon:', bboxError);
    return undefined;
  }
}

function readSelfServeCampaignDraft(): SelfServeCampaignDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SELF_SERVE_CAMPAIGN_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SelfServeCampaignDraft>;
    if (!parsed.name || parsed.polygon?.type !== 'Polygon' || !Array.isArray(parsed.polygon.coordinates)) return null;
    return {
      name: parsed.name,
      polygon: parsed.polygon,
      bbox: Array.isArray(parsed.bbox) ? parsed.bbox : undefined,
      referralCode: typeof parsed.referralCode === 'string' ? parsed.referralCode : null,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeSelfServeCampaignDraft(draft: SelfServeCampaignDraft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SELF_SERVE_CAMPAIGN_DRAFT_KEY, JSON.stringify(draft));
}

function clearSelfServeCampaignDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SELF_SERVE_CAMPAIGN_DRAFT_KEY);
}

function buildSelfServeOnboardingPath(searchParams: { get(name: string): string | null }): string {
  const onboardingParams = new URLSearchParams({
    source: 'self-serve-demo',
    campaign: 'self-serve-campaign',
    resumeCampaign: '1',
  });
  const referralCode = searchParams.get('referralCode') ?? searchParams.get('ref');
  if (referralCode) onboardingParams.set('referralCode', referralCode);
  return `/onboarding?${onboardingParams.toString()}`;
}

function isCampaignHomeLimitMessage(message: string): boolean {
  return /1,000 homes|2,000 homes|too big|too large|smaller block|campaign_home_limit|campaign_too_large/i.test(
    message
  );
}

async function waitForCampaignMapReady(campaignId: string, onProgress?: (message: string) => void) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAP_READY_TIMEOUT_MS) {
    const response = await fetch(`/api/campaigns/${campaignId}`, {
      credentials: 'include',
      cache: 'no-store',
    });

    if (response.ok) {
      const state = await response.json().catch(() => ({}));
      const status =
        typeof state.provision_status === 'string'
          ? state.provision_status
          : typeof state.status === 'string'
            ? state.status
            : null;
      const phase = typeof state.provision_phase === 'string' ? state.provision_phase : null;

      if (status === 'failed') {
        const failureReason =
          typeof state.data_quality_reason === 'string' && state.data_quality_reason.trim()
            ? state.data_quality_reason
            : typeof state.link_quality_reason === 'string' && state.link_quality_reason.trim()
              ? state.link_quality_reason
              : 'Campaign setup failed while preparing map geometry.';
        throw new Error(failureReason);
      }

      if (status === 'ready' && (!phase || MAP_USABLE_PHASES.has(phase))) {
        return state;
      }

      onProgress?.(phase === 'addresses_ready' ? 'Preparing map geometry...' : 'Waiting for map geometry...');
    }

    await delay(2000);
  }

  throw new Error('Campaign setup is still running. Please open the campaign again in a moment.');
}

function mapBundleFeatureCount(bundle: unknown): number {
  const record = bundle as Record<string, { features?: unknown[] } | undefined>;
  return (
    (Array.isArray(record.buildings?.features) ? record.buildings.features.length : 0) +
    (Array.isArray(record.addresses?.features) ? record.addresses.features.length : 0) +
    (Array.isArray(record.parcels?.features) ? record.parcels.features.length : 0)
  );
}

function mapBundleAddressCount(bundle: unknown): number {
  const record = bundle as Record<string, { features?: unknown[] } | undefined>;
  return Array.isArray(record.addresses?.features) ? record.addresses.features.length : 0;
}

async function prewarmCampaignMapBundleForOpen(campaignId: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAP_BUNDLE_TIMEOUT_MS) {
    const response = await fetch(`/api/campaigns/${campaignId}/map-bundle`, {
      credentials: 'include',
      cache: 'no-store',
    });

    if (response.ok) {
      const bundle = await response.json().catch(() => null);
      if (bundle && (bundle.map_ready === true || bundle.status === 'ready' || mapBundleFeatureCount(bundle) > 0)) {
        return bundle;
      }
    }

    await delay(1500);
  }

  throw new Error('Map bundle is still warming. Please open the campaign again in a moment.');
}

export default function CreateCampaignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme } = useTheme();
  const { currentWorkspace, currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const isSelfServeDemo = searchParams.get('source') === 'self-serve-demo';
  const copy = getIndustryCopy(isSelfServeDemo ? undefined : currentWorkspace?.industry);
  const shouldResumeSelfServeCampaign = isSelfServeDemo && searchParams.get('resumeCampaign') === '1';
  const mapTheme = isSelfServeDemo ? 'light' : theme;
  const resolvedMapStyle = useMemo(() => resolveMapStyle('standard', mapTheme, 'v11'), [mapTheme]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState<string>('');
  const [generatingAddresses, setGeneratingAddresses] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [loadingAnimationData, setLoadingAnimationData] = useState<object | null>(null);
  const [addressCount, setAddressCount] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapStyleRevision, setMapStyleRevision] = useState(0);
  const [isSatellite, setIsSatellite] = useState(false);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [assignmentDeadline, setAssignmentDeadline] = useState('');
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(false);
  const showCampaignOverlays = false;
  const [campaignOverlays, setCampaignOverlays] = useState<TerritoryOverlayCampaign[]>([]);
  const [feedbackDialog, setFeedbackDialog] = useState<CreateCampaignDialogState | null>(null);
  const [selfServeLocationState, setSelfServeLocationState] = useState<SelfServeLocationState>('idle');
  const [selfServeLocationError, setSelfServeLocationError] = useState<string | null>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const campaignOverlayPopupRef = useRef<mapboxgl.Popup | null>(null);
  const boundaryLayerIdsRef = useRef<string[]>([]);
  const appliedBaseStyleKeyRef = useRef<string | null>(null);
  const hasCenteredOnUserLocationRef = useRef(false);
  const feedbackDialogResolveRef = useRef<(() => void) | null>(null);
  const pendingSelfServeDraftRef = useRef<SelfServeCampaignDraft | null>(null);
  const freeCampaignLimitCheckedRef = useRef(false);
  const selfServeDraftRestoredRef = useRef(false);
  const selfServeDraftSubmitStartedRef = useRef(false);
  const selfServeTerritoryHandoffStartedRef = useRef(false);
  const selfServeLocationRequestStartedRef = useRef(false);
  const isDark = mapTheme === 'dark';
  const lottieSrc = useMemo(() => (isDark ? '/loading/white.json' : '/loading/black.json'), [isDark]);
  const { phase, setPhase, startCreating } = useTerritoryCreatePhase({
    map,
    mapLoaded,
  });
  const isBusy = loading || provisioning || generatingAddresses;
  const currentWorkspaceRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canAssignOnCreate = !isSelfServeDemo && (currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin');
  const selectedTeamMembers = useMemo(
    () => teamMembers.filter((member) => selectedMemberIds.includes(member.user_id)),
    [selectedMemberIds, teamMembers],
  );
  const createButtonLabel = isSelfServeDemo ? 'Create Prospecting Map' : copy.actions.createCampaign;
  const campaignNameLabel = isSelfServeDemo ? 'Prospecting map name' : copy.campaigns.nameLabel;
  const campaignNamePlaceholder = isSelfServeDemo ? 'My neighborhood prospecting map' : copy.campaigns.namePlaceholder;

  useEffect(() => {
    if (isSelfServeDemo || !currentWorkspaceId || freeCampaignLimitCheckedRef.current) return;
    freeCampaignLimitCheckedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const [accessResponse, campaignsResponse] = await Promise.all([
          fetch('/api/access/state', { credentials: 'include' }),
          fetch(`/api/campaigns?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { credentials: 'include' }),
        ]);
        if (cancelled || !accessResponse.ok || !campaignsResponse.ok) return;
        const access = (await accessResponse.json().catch(() => null)) as { plan?: string | null } | null;
        const campaigns = (await campaignsResponse.json().catch(() => [])) as unknown;
        if (access?.plan === 'free' && Array.isArray(campaigns) && campaigns.length > 0) {
          setShowPaywall(true);
        }
      } catch {
        // Creation still performs the authoritative server-side limit check.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, isSelfServeDemo]);

  const campaignOverlayFeatureCollection = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>>(
    () => ({
      type: 'FeatureCollection',
      features: campaignOverlays.map((campaign) => {
        const assigneesText = campaign.assignees.length > 0 ? campaign.assignees.join(', ') : 'Unassigned';
        const progressText = `${campaign.progress.visited} / ${campaign.progress.total} homes · ${campaign.progress.percent}%`;

        return {
          type: 'Feature',
          id: campaign.id,
          geometry: campaign.geometry,
          properties: {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            assigneesText,
            progressText,
          },
        };
      }),
    }),
    [campaignOverlays],
  );

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  useEffect(() => {
    if (!shouldResumeSelfServeCampaign || !userId || !mapLoaded || !drawRef.current || selfServeDraftRestoredRef.current) {
      return;
    }

    const draft = readSelfServeCampaignDraft();
    if (!draft) return;

    const featureCollection: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: draft.polygon,
        },
      ],
    };

    pendingSelfServeDraftRef.current = draft;
    selfServeDraftRestoredRef.current = true;
    setName(draft.name || DEFAULT_SELF_SERVE_CAMPAIGN_NAME);
    setPhase('drawing');
    savedFeaturesRef.current = featureCollection;
    drawRef.current.set(featureCollection);
    drawRef.current.changeMode('simple_select');
  }, [mapLoaded, setPhase, shouldResumeSelfServeCampaign, userId]);

  useEffect(() => {
    if (!showCampaignOverlays || !currentWorkspaceId) {
      setCampaignOverlays([]);
      return;
    }

    let cancelled = false;

    fetch(`/api/campaigns/territory-overlays?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as TerritoryOverlaysPayload;
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load campaign overlays.');
        }
        setCampaignOverlays(Array.isArray(payload.campaigns) ? payload.campaigns : []);
      })
      .catch((error) => {
        if (cancelled) return;
        setCampaignOverlays([]);
        console.warn('[CreateCampaignPage] Failed to load campaign territory overlays:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, showCampaignOverlays]);

  useEffect(() => {
    let cancelled = false;
    fetch(lottieSrc)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setLoadingAnimationData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lottieSrc]);

  useEffect(() => {
    return () => {
      feedbackDialogResolveRef.current?.();
      feedbackDialogResolveRef.current = null;
    };
  }, []);

  const dismissFeedbackDialog = () => {
    setFeedbackDialog(null);
    const resolve = feedbackDialogResolveRef.current;
    feedbackDialogResolveRef.current = null;
    resolve?.();
  };

  const showFeedbackDialog = ({
    title,
    description,
    tone = 'default',
    actionLabel = 'OK',
  }: {
    title: string;
    description: string;
    tone?: CreateCampaignDialogTone;
    actionLabel?: string;
  }) =>
    new Promise<void>((resolve) => {
      feedbackDialogResolveRef.current?.();
      feedbackDialogResolveRef.current = resolve;
      setFeedbackDialog({ title, description, tone, actionLabel });
    });

  useEffect(() => {
    if (!canAssignOnCreate || !currentWorkspaceId) {
      setTeamMembers([]);
      setSelectedMemberIds([]);
      return;
    }

    let mounted = true;
    setLoadingTeamMembers(true);
    fetch(`/api/team/roster?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
      credentials: 'include',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { members?: TeamMember[] } | null) => {
        if (!mounted) return;
        const roster = Array.isArray(payload?.members) ? payload.members : [];
        setTeamMembers(roster);
        setSelectedMemberIds((current) => {
          const validCurrent = current.filter((id) => roster.some((member) => member.user_id === id));
          if (validCurrent.length > 0) return validCurrent;
          return [];
        });
      })
      .catch(() => {
        if (!mounted) return;
        setTeamMembers([]);
        setSelectedMemberIds([]);
      })
      .finally(() => {
        if (mounted) setLoadingTeamMembers(false);
      });

    return () => {
      mounted = false;
    };
  }, [canAssignOnCreate, currentWorkspaceId]);

  const currentStepText = isSelfServeDemo
    ? provisionProgress || 'We are building your custom prospecting map...'
    : generatingAddresses
      ? 'Step 3/5: Fetching addresses'
      : provisionProgress.includes('Scanning')
        ? 'Step 4/5: Fetching buildings'
        : provisionProgress.includes('Matching') || provisionProgress.includes('Linking')
          ? 'Step 4/5: Linking addresses to buildings'
          : provisionProgress.includes('Finalizing')
            ? 'Step 5/5: Preparing optimized route'
            : 'Step 5/5: Finishing setup';

  /** Add residential-only 2D building footprints from Mapbox vector tiles.
   *  Hides built-in style buildings and renders residential buildings with theme-aware slate at 80% opacity.
   *  Works with streets-v11 / dark-v11 / satellite-streets-v12 styles. */
  const add2DBuildingsLayer = (m: mapboxgl.Map) => {
    const buildingLayerId = '2d-buildings';
    if (m.getLayer(buildingLayerId)) return; // already added
    // Only add the composite building overlay for Mapbox styles that
    // include the composite source. Custom styles (PMTiles, external
    // tilesets) do not have composite and will throw if we attempt
    // to add a layer from it.
    if (!m.getSource('composite')) return;
    const buildingFill = isDark ? '#475569' : '#cfd8e3';
    const buildingOutline = isDark ? '#334155' : '#94a3b8';

    const layers = m.getStyle().layers;

    applyPresetVisualTweaks(m, resolvedMapStyle, {
      preserveLayerIds: [buildingLayerId],
      preserveLayerPrefixes: ['gl-draw-'],
    });

    // Hide ALL built-in building layers from the base style (includes 3D extrusions)
    hideBaseBuildingLayers(m, { preserveLayerIds: [buildingLayerId] });

    // Find the first symbol layer so buildings render beneath labels
    let labelLayerId: string | undefined;
    for (const layer of layers) {
      const symbolLayer = layer as mapboxgl.SymbolLayer;
      if (layer.type === 'symbol' && symbolLayer.layout?.['text-field']) {
        labelLayerId = layer.id;
        break;
      }
    }

    m.addLayer(
      {
        id: buildingLayerId,
        source: 'composite',
        'source-layer': 'building',
        type: 'fill',
        minzoom: 12,
        // Exclude explicitly non-residential building types
        filter: [
          'match',
          ['get', 'type'],
          [
            'commercial',
            'industrial',
            'retail',
            'warehouse',
            'office',
            'church',
            'cathedral',
            'chapel',
            'temple',
            'mosque',
            'hospital',
            'civic',
            'government',
            'public',
            'university',
            'school',
            'college',
            'kindergarten',
            'train_station',
            'transportation',
            'hangar',
            'parking',
            'garage',
            'garages',
            'service',
            'manufacture',
            'factory',
            'supermarket',
            'hotel',
            'motel',
            'stadium',
            'grandstand',
            'fire_station',
            'barn',
            'silo',
            'greenhouse',
            'kiosk',
            'roof',
            'ruins',
            'bridge',
            'construction',
          ],
          false,
          true,
        ],
        paint: {
          'fill-color': buildingFill,
          'fill-opacity': 0.8,
          'fill-outline-color': buildingOutline,
        },
      },
      labelLayerId,
    );
  };

  // Initialize map with drawing controls
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const token = getMapboxToken();
    mapboxgl.accessToken = token;

    // Initialize map (style follows app theme)
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: resolvedMapStyle.style,
      config: resolvedMapStyle.config,
      center: [-79.35, 43.65], // Default to Toronto area
      zoom: 15,
    });
    appliedBaseStyleKeyRef.current = resolvedMapStyle.key;

    map.current.on('load', () => {
      setMapLoaded(true);
      setMapStyleRevision((current) => current + 1);
      if (!isSatellite) {
        add2DBuildingsLayer(map.current!);
      }
    });

    // Initialize Mapbox Draw with red styling (no visible controls - draw by clicking)
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {}, // Hide all default controls to avoid duplicates
      defaultMode: 'simple_select',
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
        // Temporarily suppress AbortError from Mapbox's in-flight tile requests
        const suppressAbort = (e: PromiseRejectionEvent) => {
          if (e.reason?.name === 'AbortError') e.preventDefault();
        };
        window.addEventListener('unhandledrejection', suppressAbort);
        removeMapboxMapWhenSafe(map.current);
        map.current = null;
        setTimeout(() => window.removeEventListener('unhandledrejection', suppressAbort), 0);
      }
    };
  }, []);

  // Store drawn features for restoration after style change
  const savedFeaturesRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Handle map style change - recreate draw instance to avoid source conflicts
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const expectedStyleKey = isSatellite ? 'satellite' : resolvedMapStyle.key;
    if (appliedBaseStyleKeyRef.current === expectedStyleKey && drawRef.current) return;

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

    // Clear boundary layer ref so we never call getLayer with stale IDs after style replace
    boundaryLayerIdsRef.current = [];
    // Change style
    if (isSatellite) {
      map.current.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
    } else {
      applyResolvedMapStyle(map.current, resolvedMapStyle);
    }

    // After style loads, re-add 2D buildings and create fresh draw instance
    map.current.once('style.load', () => {
      if (!map.current) return;
      appliedBaseStyleKeyRef.current = expectedStyleKey;
      setMapStyleRevision((current) => current + 1);

      // Keep custom residential building overlays off satellite mode.
      if (!isSatellite) {
        add2DBuildingsLayer(map.current);
      }

      // Create fresh draw instance
      const newDraw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: 'simple_select',
        styles: [
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
          {
            id: 'gl-draw-polygon-stroke-active',
            type: 'line',
            filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#ef4444', 'line-width': 3 },
          },
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
          {
            id: 'gl-draw-polygon-midpoint',
            type: 'circle',
            filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
            paint: { 'circle-radius': 4, 'circle-color': '#ef4444' },
          },
          {
            id: 'gl-draw-line-active',
            type: 'line',
            filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#ef4444',
              'line-width': 3,
              'line-dasharray': [0.2, 2],
            },
          },
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
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#ef4444', 'line-width': 3 },
          },
        ],
      });

      map.current.addControl(newDraw);
      drawRef.current = newDraw;

      // Restore saved features
      const savedFeatures = savedFeaturesRef.current;
      const hasSavedFeatures = (savedFeatures?.features?.length ?? 0) > 0;
      if (hasSavedFeatures && savedFeatures) {
        newDraw.set(savedFeatures);
      }
      applyDrawModeForPhase(newDraw, phase, hasSavedFeatures);
    });
  }, [isSatellite, mapLoaded, phase, resolvedMapStyle]);

  useEffect(() => {
    if (!mapLoaded || !drawRef.current) return;
    const hasSavedFeatures = (drawRef.current.getAll()?.features?.length ?? 0) > 0;
    applyDrawModeForPhase(drawRef.current, phase, hasSavedFeatures);
  }, [mapLoaded, phase]);

  useEffect(() => {
    if (!isSelfServeDemo || phase !== 'naming') return;
    setPhase('drawing');
    drawRef.current?.changeMode('simple_select');
  }, [isSelfServeDemo, phase, setPhase]);

  useEffect(() => {
    if (!isSelfServeDemo || !mapLoaded || !map.current) return;
    const mapInstance = map.current;

    const handleSelfServeDrawCreate = () => {
      if (selfServeTerritoryHandoffStartedRef.current) return;
      const polygon = getDrawnPolygon(drawRef.current);
      if (!polygon) return;
      selfServeTerritoryHandoffStartedRef.current = true;
      drawRef.current?.changeMode('simple_select');
      void createSelfServeCampaignInBackground(polygon, calculateBboxForPolygon(polygon), {
        handoffStarted: true,
      });
    };

    mapInstance.on('draw.create', handleSelfServeDrawCreate);
    return () => {
      mapInstance.off('draw.create', handleSelfServeDrawCreate);
    };
  }, [isSelfServeDemo, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    if (!showCampaignOverlays || campaignOverlayFeatureCollection.features.length === 0) {
      removeCampaignOverlaySource(map.current);
      campaignOverlayPopupRef.current?.remove();
      campaignOverlayPopupRef.current = null;
      return;
    }

    try {
      upsertCampaignOverlayLayers(map.current, campaignOverlayFeatureCollection);
    } catch (error) {
      console.warn('[CreateCampaignPage] Failed to render campaign territory overlays:', error);
    }
  }, [campaignOverlayFeatureCollection, mapLoaded, mapStyleRevision, showCampaignOverlays]);

  useEffect(() => {
    if (!mapLoaded || !map.current || !showCampaignOverlays) return;
    const mapInstance = map.current;
    if (!mapInstance.getLayer(CAMPAIGN_OVERLAY_FILL_LAYER_ID)) return;

    const showPopup = (
      event: mapboxgl.MapMouseEvent & {
        features?: mapboxgl.MapboxGeoJSONFeature[];
      },
      options: { closeButton: boolean; closeOnClick: boolean },
    ) => {
      const feature = event.features?.[0];
      if (!feature?.properties) return;

      const name = String(feature.properties.name ?? 'Untitled Campaign');
      const assigneesText = String(feature.properties.assigneesText ?? 'Unassigned');
      const progressText = String(feature.properties.progressText ?? '0 / 0 homes · 0%');

      campaignOverlayPopupRef.current?.remove();
      campaignOverlayPopupRef.current = new mapboxgl.Popup({
        closeButton: options.closeButton,
        closeOnClick: options.closeOnClick,
        maxWidth: '280px',
        offset: 12,
      })
        .setLngLat(event.lngLat)
        .setHTML(
          `
          <div style="font-family: inherit; min-width: 190px;">
            <div style="font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 4px;">${escapeHtml(name)}</div>
            <div style="font-size: 12px; color: #4b5563; line-height: 1.45;">Assigned to: ${escapeHtml(assigneesText)}</div>
            <div style="font-size: 12px; color: #4b5563; line-height: 1.45;">Visited: ${escapeHtml(progressText)}</div>
          </div>
        `,
        )
        .addTo(mapInstance);
    };

    const handleMouseEnter = () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    };
    const handleMouseMove = (
      event: mapboxgl.MapMouseEvent & {
        features?: mapboxgl.MapboxGeoJSONFeature[];
      },
    ) => {
      showPopup(event, { closeButton: false, closeOnClick: false });
    };
    const handleMouseLeave = () => {
      mapInstance.getCanvas().style.cursor = '';
      campaignOverlayPopupRef.current?.remove();
      campaignOverlayPopupRef.current = null;
    };
    const handleClick = (
      event: mapboxgl.MapMouseEvent & {
        features?: mapboxgl.MapboxGeoJSONFeature[];
      },
    ) => {
      showPopup(event, { closeButton: true, closeOnClick: true });
    };

    mapInstance.on('mouseenter', CAMPAIGN_OVERLAY_FILL_LAYER_ID, handleMouseEnter);
    mapInstance.on('mousemove', CAMPAIGN_OVERLAY_FILL_LAYER_ID, handleMouseMove);
    mapInstance.on('mouseleave', CAMPAIGN_OVERLAY_FILL_LAYER_ID, handleMouseLeave);
    mapInstance.on('click', CAMPAIGN_OVERLAY_FILL_LAYER_ID, handleClick);

    return () => {
      mapInstance.off('mouseenter', CAMPAIGN_OVERLAY_FILL_LAYER_ID, handleMouseEnter);
      mapInstance.off('mousemove', CAMPAIGN_OVERLAY_FILL_LAYER_ID, handleMouseMove);
      mapInstance.off('mouseleave', CAMPAIGN_OVERLAY_FILL_LAYER_ID, handleMouseLeave);
      mapInstance.off('click', CAMPAIGN_OVERLAY_FILL_LAYER_ID, handleClick);
    };
  }, [campaignOverlayFeatureCollection, mapLoaded, mapStyleRevision, showCampaignOverlays]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    const container = map.current.getContainer();
    container.classList.toggle('flyr-territory-draw-cursor', phase === 'drawing');

    return () => {
      container.classList.remove('flyr-territory-draw-cursor');
    };
  }, [mapLoaded, phase]);

  const requestSelfServeUserLocation = async (source: 'auto' | 'manual' = 'manual') => {
    if (!isSelfServeDemo || !map.current || !mapLoaded || typeof navigator === 'undefined') return;

    if (!navigator.geolocation) {
      if (source === 'manual') {
        setSelfServeLocationError('This browser did not expose location access. Search an address to start.');
        setSelfServeLocationState('prompt');
      } else {
        setSelfServeLocationState('prompt');
      }
      return;
    }

    if (source === 'manual' && navigator.permissions?.query) {
      try {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission.state === 'denied') {
          setSelfServeLocationError(
            'Location is blocked for this site. Allow location in your browser settings, then tap Enable location again.'
          );
          setSelfServeLocationState('prompt');
          return;
        }
      } catch {
        // Some browsers support geolocation but not querying its permission state.
      }
    }

    setSelfServeLocationError(null);
    setSelfServeLocationState('requesting');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        hasCenteredOnUserLocationRef.current = true;
        setSelfServeLocationError(null);
        setSelfServeLocationState('centered');
        map.current?.flyTo({
          center: [longitude, latitude],
          zoom: 17,
          pitch: 0,
          bearing: 0,
          duration: source === 'auto' ? 1400 : 900,
        });
      },
      (error) => {
        console.warn('[CreateCampaignPage] Self-serve location unavailable:', error);
        if (source === 'manual') {
          const message =
            error.code === error.PERMISSION_DENIED
              ? 'Location is blocked for this site. Allow location in your browser settings, then tap Enable location again.'
              : error.code === error.TIMEOUT
                ? 'Location lookup timed out. Search an address to start.'
                : 'Could not get your location here. Search an address to start.';
          setSelfServeLocationError(message);
          setSelfServeLocationState('prompt');
          return;
        }
        setSelfServeLocationState('prompt');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };

  const focusSelfServeSearch = () => {
    setSelfServeLocationState('dismissed');
    window.requestAnimationFrame(() => {
      document.getElementById('campaign-map-search')?.focus();
    });
  };

  useEffect(() => {
    if (
      !isSelfServeDemo ||
      shouldResumeSelfServeCampaign ||
      !mapLoaded ||
      !map.current ||
      selfServeLocationRequestStartedRef.current
    ) {
      return;
    }

    selfServeLocationRequestStartedRef.current = true;
    setSelfServeLocationState('prompt');
    // This intentionally runs once when the self-serve map first becomes usable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelfServeDemo, mapLoaded, shouldResumeSelfServeCampaign]);

  // Keep map fully sized when surrounding layout (e.g. campaign sidebar) collapses/expands.
  useEffect(() => {
    if (!mapLoaded || !map.current || !mapContainer.current) return;

    const mapInstance = map.current;
    const container = mapContainer.current;
    let frameId: number | null = null;

    const resizeMap = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        try {
          mapInstance.resize();
        } catch {
          // Ignore transient resize errors during style transitions/unmount.
        }
      });
    };

    const observer = new ResizeObserver(() => {
      resizeMap();
    });
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

  const toggleSatelliteView = () => {
    setIsSatellite(!isSatellite);
  };

  const handleZoomIn = () => {
    map.current?.zoomIn({ duration: 220 });
  };

  const handleZoomOut = () => {
    map.current?.zoomOut({ duration: 220 });
  };

  const handleStartCreating = () => {
    drawRef.current?.deleteAll();
    savedFeaturesRef.current = null;
    selfServeTerritoryHandoffStartedRef.current = false;
    startCreating();
    drawRef.current?.changeMode('draw_polygon');
  };

  const handlePrimaryCreateAction = () => {
    if (phase === 'idle') {
      handleStartCreating();
      return;
    }

    if (phase === 'drawing') {
      const polygon = getDrawnPolygon(drawRef.current);
      if (!polygon) {
        void showFeedbackDialog({
          title: 'Finish the territory boundary',
          description: 'Draw a territory boundary first. Double-click to finish your shape.',
          tone: 'warning',
        });
        return;
      }
      if (isSelfServeDemo) {
        drawRef.current?.changeMode('simple_select');
        void createSelfServeCampaignInBackground(polygon, calculateBboxForPolygon(polygon));
        return;
      }
      setPhase('naming');
      drawRef.current?.changeMode('simple_select');
      return;
    }

    if (isSelfServeDemo) {
      const polygon = getDrawnPolygon(drawRef.current);
      if (!polygon) {
        void showFeedbackDialog({
          title: 'Finish the territory boundary',
          description: 'Draw a territory boundary first. Double-click to finish your shape.',
          tone: 'warning',
        });
        return;
      }
      void createSelfServeCampaignInBackground(polygon, calculateBboxForPolygon(polygon));
      return;
    }

    void handleSubmit();
  };

  const clearDrawing = () => {
    selfServeTerritoryHandoffStartedRef.current = false;
    const nextPhase = clearTerritoryDrawing(drawRef.current, phase);
    setPhase(nextPhase);
  };

  const startDrawing = () => {
    if (phase === 'idle') {
      handleStartCreating();
      return;
    }
    drawRef.current?.changeMode('draw_polygon');
    setPhase('drawing');
  };

  const handleNamingBack = () => {
    setPhase('drawing');
    drawRef.current?.changeMode('simple_select');
  };

  const handleMapSearchSelect = (suggestion: AddressSuggestion) => {
    if (!map.current || !mapLoaded) return;

    map.current.flyTo({
      center: [suggestion.coordinate.longitude, suggestion.coordinate.latitude],
      zoom: 18,
      duration: 1500, // Smooth animation
    });
  };

  const startSelfServeCampaignProvision = async (campaignId: string) => {
    const response = await fetch('/api/campaigns/provision', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(
        typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error
          : `Provision kickoff failed (${response.status})`
      );
    }

    try {
      window.sessionStorage.setItem(`flyr-self-serve-provision-started:${campaignId}`, '1');
    } catch {
      // Session storage is best-effort; the detail page can still poll campaign status.
    }
  };

  const openSelfServeCampaignWhenReady = async (campaignId: string) => {
    setProvisioning(true);
    setProvisionProgress('Starting your prospecting map...');
    clearSelfServeCampaignDraft();
    window.dispatchEvent(new CustomEvent('flyr-campaigns-refresh'));
    await startSelfServeCampaignProvision(campaignId);
    setProvisionProgress('Opening your prospecting map...');
    router.push(`/campaigns/${campaignId}?source=self-serve-demo`);
  };

  const createSelfServeCampaignInBackground = async (
    polygon: GeoJSON.Polygon,
    bbox?: number[],
    options?: { handoffStarted?: boolean },
  ) => {
    if (!options?.handoffStarted) {
      if (selfServeTerritoryHandoffStartedRef.current) return;
      selfServeTerritoryHandoffStartedRef.current = true;
    }
    const campaignName = name.trim() || DEFAULT_SELF_SERVE_CAMPAIGN_NAME;

    if (!shouldResumeSelfServeCampaign || !userId) {
      writeSelfServeCampaignDraft({
        name: campaignName,
        polygon,
        bbox,
        referralCode: searchParams.get('referralCode') ?? searchParams.get('ref') ?? null,
        createdAt: new Date().toISOString(),
      });
      router.push(buildSelfServeOnboardingPath(searchParams));
      return;
    }

    setLoading(true);
    try {
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName,
          type: 'prospecting',
          address_source: 'map',
          workspace_id: currentWorkspaceId ?? undefined,
          description: 'Self-serve prospecting map created from the demo flow.',
          tags: 'self-serve-demo,prospecting-map',
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create prospecting map (${createRes.status})`);
      }

      const campaign = await createRes.json();
      const boundaryResponse = await fetch(`/api/campaigns/${campaign.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          territory_boundary: polygon,
          bbox,
        }),
      });
      if (!boundaryResponse.ok) {
        const error = await boundaryResponse.json().catch(() => ({}));
        throw new Error(error.error || `Failed to save territory boundary (${boundaryResponse.status})`);
      }

      await openSelfServeCampaignWhenReady(campaign.id);
    } catch (error: unknown) {
      selfServeTerritoryHandoffStartedRef.current = false;
      console.error('Error creating self-serve prospecting map:', error);
      const errorMessage = error instanceof Error && error.message ? error.message : 'Unknown error occurred';
      await showFeedbackDialog({
        title: 'Failed to create prospecting map',
        description: errorMessage,
        tone: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!name.trim()) {
      await showFeedbackDialog({
        title: `${copy.nouns.campaign.charAt(0).toUpperCase()}${copy.nouns.campaign.slice(1)} name required`,
        description: `Enter a ${copy.nouns.campaign} name to continue.`,
        tone: 'warning',
      });
      return;
    }

    const polygon = getDrawnPolygon(drawRef.current);
    if (!polygon) {
      await showFeedbackDialog({
        title: 'Territory boundary required',
        description: 'Please draw a territory boundary on the map. Double-click to finish your shape.',
        tone: 'warning',
      });
      return;
    }

    if (selectedMemberIds.length > 0 && !assignmentDeadline) {
      await showFeedbackDialog({
        title: 'Deadline required',
        description: 'Choose a deadline for the assigned campaign.',
        tone: 'warning',
      });
      return;
    }

    const bbox = calculateBboxForPolygon(polygon);

    if (!userId) {
      if (!isSelfServeDemo) return;
      writeSelfServeCampaignDraft({
        name: name.trim() || DEFAULT_SELF_SERVE_CAMPAIGN_NAME,
        polygon,
        bbox,
        referralCode: searchParams.get('referralCode') ?? searchParams.get('ref') ?? null,
        createdAt: new Date().toISOString(),
      });
      router.push(buildSelfServeOnboardingPath(searchParams));
      return;
    }

    setLoading(true);
    try {
      // Create campaign server-side so generate-address-list and provision find it in Supabase
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: isSelfServeDemo ? name.trim() || DEFAULT_SELF_SERVE_CAMPAIGN_NAME : name,
          type: isSelfServeDemo ? 'prospecting' : 'flyer',
          address_source: 'map',
          workspace_id: currentWorkspaceId ?? undefined,
          description: isSelfServeDemo ? 'Self-serve prospecting map created from the demo flow.' : undefined,
          tags: isSelfServeDemo ? 'self-serve-demo,prospecting-map' : undefined,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        if (isWorkspaceCampaignLimitResponse(err)) {
          setShowPaywall(true);
          return;
        }
        throw new Error(err.error || `Failed to create campaign (${createRes.status})`);
      }
      const campaign = await createRes.json();
      console.log('Campaign created:', campaign?.id, campaign?.name);

      if (polygon) {
        setProvisioning(true);
        setProvisionProgress(
          isSelfServeDemo ? 'We are building your custom prospecting map...' : 'Saving territory boundary...'
        );
        try {
          let campaignReadyForAssignment = false;
          const boundaryResponse = await fetch(`/api/campaigns/${campaign.id}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              territory_boundary: polygon,
              bbox,
            }),
          });
          if (!boundaryResponse.ok) {
            const error = await boundaryResponse.json().catch(() => ({}));
            throw new Error(error.error || `Failed to save territory boundary (${boundaryResponse.status})`);
          }

          if (isSelfServeDemo) {
            await openSelfServeCampaignWhenReady(campaign.id);
            return;
          }

          setProvisionProgress(isSelfServeDemo ? 'Finding homes in your neighborhood...' : 'Scanning 3D Shapes...');
          const progressInterval = setInterval(() => {
            setProvisionProgress((prev) => {
              if (isSelfServeDemo) {
                if (prev === 'Finding homes in your neighborhood...') return 'Matching addresses to 3D homes...';
                if (prev === 'Matching addresses to 3D homes...') return 'Finalizing your prospecting map...';
                return prev;
              }
              if (prev === 'Scanning 3D Shapes...') return 'Matching Addresses...';
              if (prev === 'Matching Addresses...') return 'Finalizing Mission Territory...';
              return prev;
            });
          }, 2000);

          try {
            const provisionResponse = await fetch('/api/campaigns/provision', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                campaign_id: campaign.id,
              }),
            });

            clearInterval(progressInterval);
            setProvisionProgress(isSelfServeDemo ? 'Finalizing your prospecting map...' : 'Finalizing Mission Territory...');

            if (!provisionResponse.ok) {
              const error = await provisionResponse.json().catch(() => ({}));
              console.error('Provisioning error:', error);
              const message =
                typeof error.error === 'string' && error.error.trim()
                  ? error.error
                  : 'Campaign created but provisioning failed.';
              const isHomeLimitError =
                error.code === 'campaign_home_limit_exceeded' || error.code === 'campaign_too_large_for_app';
              setProvisioning(false);
              setProvisionProgress('');
              await showFeedbackDialog({
                title: isHomeLimitError ? 'Territory is too large' : 'Provisioning failed',
                description: isHomeLimitError ? message : `Campaign created but provisioning failed: ${message}`,
                tone: isHomeLimitError ? 'warning' : 'destructive',
                actionLabel: isHomeLimitError ? 'Back to drawing' : 'OK',
              });
              return;
            } else {
              const result = await provisionResponse.json().catch(() => ({}));
              const { addresses_saved = 0, buildings_saved = 0, links_created = 0 } = result;
              if (addresses_saved > 0) {
                setAddressCount(addresses_saved);
              }
              console.log('Campaign provision started:', {
                status: provisionResponse.status,
                addresses_saved,
                buildings_saved,
                links_created,
              });
              if (result.warning) {
                await showFeedbackDialog({
                  title: 'Campaign warning',
                  description: result.warning,
                  tone: 'warning',
                });
              }
              if (addresses_saved > 0 && links_created > 0 && links_created < addresses_saved) {
                setProvisionProgress(`Linking: ${links_created} / ${addresses_saved} addresses...`);
              }
              setProvisionProgress(isSelfServeDemo ? 'We are building your custom prospecting map...' : 'Waiting for map geometry...');
              await waitForCampaignMapReady(campaign.id, setProvisionProgress);
              setProvisionProgress('Preparing your 3D homes...');
              const bundle = await prewarmCampaignMapBundleForOpen(campaign.id);
              const bundleAddressCount = mapBundleAddressCount(bundle);
              if (bundleAddressCount > 0) {
                setAddressCount(bundleAddressCount);
              }
              campaignReadyForAssignment = true;
            }
          } finally {
            clearInterval(progressInterval);
          }

          if (campaignReadyForAssignment && selectedMemberIds.length > 0 && currentWorkspaceId) {
            setProvisionProgress('Assigning campaign to team...');
            const assignmentResponse = await fetch(`/api/campaigns/${campaign.id}/assignments`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workspaceId: currentWorkspaceId,
                mode: 'whole_team',
                memberIds: selectedMemberIds,
                dueAt: `${assignmentDeadline}T23:59:59`,
                notes: null,
              }),
            });

            if (!assignmentResponse.ok) {
              const error = await assignmentResponse.json().catch(() => ({}));
              await showFeedbackDialog({
                title: 'Assignment failed',
                description: `Campaign created but assignment failed: ${error.error || 'Unknown error'}`,
                tone: 'destructive',
              });
            } else {
              const result = (await assignmentResponse.json().catch(() => null)) as { warnings?: string[] } | null;
              const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
              if (warnings.length > 0) {
                await showFeedbackDialog({
                  title: 'Notifications need attention',
                  description: `Campaign assigned, but some notifications need attention: ${warnings.slice(0, 3).join(' ')}`,
                  tone: 'warning',
                });
              }
            }
          }
        } catch (provisionError) {
          console.error('Error provisioning campaign:', provisionError);
          const provisionMessage =
            provisionError instanceof Error && provisionError.message.trim()
              ? provisionError.message
              : 'Campaign created but provisioning failed. Please try again.';
          const isHomeLimitError = isCampaignHomeLimitMessage(provisionMessage);
          await showFeedbackDialog({
            title: isHomeLimitError ? 'Territory is too large' : 'Provisioning failed',
            description: isHomeLimitError
              ? provisionMessage
              : `Campaign created but provisioning failed: ${provisionMessage}`,
            tone: isHomeLimitError ? 'warning' : 'destructive',
            actionLabel: isHomeLimitError ? 'Back to drawing' : 'OK',
          });
        } finally {
          setProvisioning(false);
          setProvisionProgress('');
        }
      }

      if (isSelfServeDemo) {
        clearSelfServeCampaignDraft();
      }
      router.push(`/campaigns/${campaign.id}${isSelfServeDemo ? '?source=self-serve-demo' : ''}`);
      window.dispatchEvent(new CustomEvent('flyr-campaigns-refresh'));
    } catch (error: unknown) {
      console.error('Error creating campaign:', error);
      // Extract meaningful error message
      const errorDetails =
        error && typeof error === 'object'
          ? (error as {
              message?: string;
              details?: string;
              hint?: string;
              code?: string;
            })
          : {};
      const errorMessage =
        errorDetails.message || errorDetails.details || errorDetails.hint || 'Unknown error occurred';
      const errorCode = errorDetails.code ? ` (${errorDetails.code})` : '';
      await showFeedbackDialog({
        title: 'Failed to create campaign',
        description: `${errorMessage}${errorCode}`,
        tone: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const draft = pendingSelfServeDraftRef.current;
    if (
      !draft ||
      selfServeDraftSubmitStartedRef.current ||
      !shouldResumeSelfServeCampaign ||
      !userId ||
      !mapLoaded ||
      !drawRef.current ||
      phase !== 'drawing'
    ) {
      return;
    }

    selfServeDraftSubmitStartedRef.current = true;
    const timeoutId = window.setTimeout(() => {
      void createSelfServeCampaignInBackground(draft.polygon, draft.bbox);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [mapLoaded, phase, shouldResumeSelfServeCampaign, userId]);

  const selfServeSurfaceClass = isSelfServeDemo
    ? 'border-slate-200 bg-white/95 text-slate-950 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-md'
    : 'border-white/10 bg-background/92 shadow-2xl backdrop-blur-md';
  const selfServeSoftSurfaceClass = isSelfServeDemo
    ? 'border-slate-200 bg-white/90 text-slate-700'
    : 'border-border bg-card/80 text-muted-foreground';
  const selfServeInputClass = isSelfServeDemo
    ? 'h-11 border-slate-200 bg-white text-slate-950 placeholder:text-slate-400 dark:bg-white dark:text-slate-950'
    : 'h-11 bg-background';
  const selfServeControlButtonClass = isSelfServeDemo
    ? 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
    : 'border-border bg-card text-foreground hover:bg-muted/50';
  const selfServeDividerClass = isSelfServeDemo ? 'border-slate-200' : 'border-white/10';
  const isSelfServeLocationBlocked = selfServeLocationError?.startsWith('Location is blocked') ?? false;

  return (
    <div className={`h-full min-h-0 flex flex-col overflow-hidden ${isSelfServeDemo ? 'bg-white' : 'bg-gray-50 dark:bg-background'}`}>
      <div className="relative min-h-0 flex-1">
        <div ref={mapContainer} className="absolute inset-0 h-full w-full" />
        <MapInfoButton show={mapLoaded} />
        {mapLoaded && map.current && (
          <UserLocationLayer
            map={map.current}
            mapLoaded={mapLoaded}
            showUserLocation={!isSelfServeDemo}
            onLocationFound={(lng, lat) => {
              if (!hasCenteredOnUserLocationRef.current) {
                hasCenteredOnUserLocationRef.current = true;
                map.current?.flyTo({
                  center: [lng, lat],
                  zoom: 15,
                  duration: 800,
                });
              }
            }}
            onLocationError={() => {}}
          />
        )}

        {isSelfServeDemo && !shouldResumeSelfServeCampaign && selfServeLocationState === 'requesting' ? (
          <div className="absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm font-semibold text-slate-900 shadow-xl backdrop-blur-md">
            Finding your neighborhood...
          </div>
        ) : null}

        {isSelfServeDemo && !shouldResumeSelfServeCampaign && selfServeLocationState === 'prompt' ? (
          <div className="absolute left-5 top-24 z-20 w-[min(20rem,calc(100vw-2.5rem))] rounded-2xl border border-slate-200 bg-white/95 p-4 text-slate-950 shadow-2xl backdrop-blur-md">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">Start with your neighborhood</p>
                <p className="mt-1 text-xs font-medium text-slate-600">
                  {selfServeLocationError || 'Use your location so FLYR opens the map near you.'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (isSelfServeLocationBlocked) {
                      focusSelfServeSearch();
                      return;
                    }
                    void requestSelfServeUserLocation('manual');
                  }}
                  className="flex-1 rounded-xl bg-red-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
                >
                  {isSelfServeLocationBlocked ? 'Search address' : 'Enable location'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isSelfServeLocationBlocked) {
                      void requestSelfServeUserLocation('manual');
                      return;
                    }
                    focusSelfServeSearch();
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                >
                  {isSelfServeLocationBlocked ? 'Try location again' : 'Search instead'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {mapLoaded ? (
          <div className="absolute bottom-10 right-5 z-20 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5">
            <button
              type="button"
              onClick={handleZoomIn}
              className="flex h-14 w-14 items-center justify-center text-slate-950 transition hover:bg-slate-50 active:bg-slate-100"
              aria-label="Zoom in"
            >
              <Plus className="h-7 w-7" strokeWidth={3} />
            </button>
            <div className="h-px bg-slate-200" />
            <button
              type="button"
              onClick={handleZoomOut}
              className="flex h-14 w-14 items-center justify-center text-slate-950 transition hover:bg-slate-50 active:bg-slate-100"
              aria-label="Zoom out"
            >
              <Minus className="h-7 w-7" strokeWidth={3} />
            </button>
          </div>
        ) : null}

        <div className={`absolute right-5 top-5 z-20 w-[min(22rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border ${selfServeSurfaceClass}`}>
            <div className="space-y-4 p-4">
              {!mapLoaded ? (
                <div className={`rounded-xl border px-3 py-3 text-sm font-medium ${selfServeSoftSurfaceClass}`}>
                  Loading map...
                </div>
              ) : null}

              {phase === 'naming' ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="campaign-name">{campaignNameLabel}</Label>
                    <Input
                      id="campaign-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={campaignNamePlaceholder}
                      autoFocus
                      className={selfServeInputClass}
                    />
                  </div>

                  {canAssignOnCreate ? (
                    <div className={`space-y-3 rounded-xl border p-3 ${selfServeSoftSurfaceClass}`}>
                      <div className="flex items-center justify-between gap-3">
                        <Label className="flex items-center gap-2 text-sm">
                          <Users className="h-4 w-4" />
                          Assign members
                        </Label>
                        {selectedTeamMembers.length > 0 ? (
                          <span className="text-xs text-muted-foreground">{selectedTeamMembers.length} selected</span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {loadingTeamMembers ? (
                          <span className="text-xs text-muted-foreground">Loading members...</span>
                        ) : null}
                        {!loadingTeamMembers && teamMembers.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No team members found.</span>
                        ) : null}
                        {teamMembers.map((member) => {
                          const selected = selectedMemberIds.includes(member.user_id);
                          return (
                            <button
                              key={member.user_id}
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                setSelectedMemberIds((current) =>
                                  current.includes(member.user_id)
                                    ? current.filter((id) => id !== member.user_id)
                                    : [...current, member.user_id],
                                )
                              }
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                selected
                                  ? 'border-red-500 bg-red-500 text-white'
                                  : isSelfServeDemo
                                    ? 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                                    : 'border-border bg-background text-foreground hover:bg-muted/70'
                              }`}
                            >
                              {member.display_name}
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="campaign-assignment-deadline" className="flex items-center gap-2 text-sm">
                          <CalendarDays className="h-4 w-4" />
                          Deadline
                        </Label>
                        <Input
                          id="campaign-assignment-deadline"
                          type="date"
                          value={assignmentDeadline}
                          onChange={(e) => setAssignmentDeadline(e.target.value)}
                          disabled={isBusy || selectedMemberIds.length === 0}
                          className={isSelfServeDemo ? 'h-10 border-slate-200 bg-white text-slate-950 dark:bg-white dark:text-slate-950' : 'h-10 bg-background'}
                        />
                      </div>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleNamingBack}
                    disabled={isBusy}
                    className="text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                  >
                    Back to drawing
                  </button>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="campaign-map-search" className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Search address
                </Label>
                <AddressAutocomplete
                  inputId="campaign-map-search"
                  value={mapSearchQuery}
                  onChange={setMapSearchQuery}
                  onSelect={(suggestion) => {
                    handleMapSearchSelect(suggestion);
                  }}
                  placeholder="Search an address..."
                  className="flex-1"
                  inputClassName={selfServeInputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!mapLoaded}
                  onClick={toggleSatelliteView}
                  className={`flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${selfServeControlButtonClass}`}
                >
                  {isSatellite ? <Map className="h-5 w-5" /> : <Satellite className="h-5 w-5" />}
                  <span>{isSatellite ? 'Map' : 'Satellite'}</span>
                </button>
                <button
                  type="button"
                  disabled={!mapLoaded}
                  onClick={startDrawing}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-red-600 bg-red-500 px-3 text-sm font-medium text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Pencil className="h-5 w-5" />
                  <span>Draw</span>
                </button>
              </div>

              <button
                type="button"
                onClick={clearDrawing}
                disabled={!mapLoaded || phase === 'idle'}
                className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${selfServeControlButtonClass}`}
              >
                <Trash2 className="h-5 w-5" />
                <span>Clear boundary</span>
              </button>

              <div className={`border-t pt-4 ${selfServeDividerClass}`}>
                <button
                  type="button"
                  disabled={!mapLoaded || isBusy}
                  onClick={handlePrimaryCreateAction}
                  className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-red-500 px-5 text-lg font-semibold text-white shadow-xl transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="text-2xl leading-none">+</span>
                  <span>{!mapLoaded ? 'Loading map...' : isBusy ? 'Creating...' : createButtonLabel}</span>
                </button>
              </div>
            </div>
          </div>

        <TerritoryDrawHint visible={mapLoaded && phase === 'drawing'} />
      </div>

      {(provisioning || generatingAddresses) && (
        <div className="fixed inset-0 bg-black/35 backdrop-blur-[1px] flex items-center justify-center z-50">
          <div className="max-w-lg w-full mx-4 text-center">
            <div className="h-80 w-full flex items-center justify-center">
              {loadingAnimationData ? (
                <Lottie
                  animationData={loadingAnimationData}
                  loop
                  className="h-full w-full"
                  rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                />
              ) : (
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              )}
            </div>
            <div className="pt-3">
              <h3 className="text-lg font-semibold text-white mb-3">
                {isSelfServeDemo ? 'We are building your custom prospecting map' : copy.campaigns.generatingTitle}
              </h3>
              <div className="space-y-2">
                <p className="text-sm font-medium text-white/95">{currentStepText}</p>
                <p className="text-sm text-white/90">Syncing property data...</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={!!feedbackDialog} onOpenChange={(open) => !open && dismissFeedbackDialog()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          {feedbackDialog ? (
            <>
              <DialogHeader className="text-left sm:text-left">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border ${
                      feedbackDialog.tone === 'destructive'
                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                        : feedbackDialog.tone === 'warning'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'border-primary/30 bg-primary/10 text-primary'
                    }`}
                  >
                    {feedbackDialog.tone === 'destructive' ? (
                      <CircleAlert className="size-5" />
                    ) : (
                      <TriangleAlert className="size-5" />
                    )}
                  </div>
                  <div className="space-y-2">
                    <DialogTitle className="text-lg leading-6">{feedbackDialog.title}</DialogTitle>
                    <DialogDescription className="text-sm leading-6">{feedbackDialog.description}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant={feedbackDialog.tone === 'destructive' ? 'destructive' : 'default'}
                  onClick={dismissFeedbackDialog}
                >
                  {feedbackDialog.actionLabel}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <PaywallGuard open={showPaywall} onClose={() => setShowPaywall(false)} />
    </div>
  );
}
