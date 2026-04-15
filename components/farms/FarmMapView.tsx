'use client';

import { useMemo, useState } from 'react';
import { CampaignDetailMapView } from '@/components/campaigns/CampaignDetailMapView';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FarmTouchOutcomeService } from '@/lib/services/FarmService';
import type {
  CampaignAddress,
  CampaignV2,
  Farm,
  FarmAddress,
  FarmAddressOutcomeStatus,
  FarmTouchAddress,
} from '@/types/database';

type MapLayerScope = 'all_time' | 'current_cycle' | 'session';
const VISITED_OUTCOME_STATUSES = new Set<FarmAddressOutcomeStatus>([
  'no_answer',
  'delivered',
  'talked',
  'appointment',
  'do_not_knock',
  'future_seller',
  'hot_lead',
]);

const MAP_OUTCOME_ACTIONS: Array<{ status: FarmAddressOutcomeStatus; label: string }> = [
  { status: 'delivered', label: 'Visited' },
  { status: 'no_answer', label: 'No Answer' },
  { status: 'talked', label: 'Conversation' },
  { status: 'do_not_knock', label: 'DNC' },
  { status: 'none', label: 'Reset' },
];

function parseFarmPolygon(farm: Farm): GeoJSON.Polygon | null {
  if (!farm.polygon) return null;
  try {
    const parsed = JSON.parse(farm.polygon) as GeoJSON.Polygon;
    if (parsed?.type === 'Polygon' && Array.isArray(parsed.coordinates)) {
      return parsed;
    }
  } catch {}
  return null;
}

export function FarmMapView({
  farm,
  addresses,
  linkedCampaignId,
  layerScope = 'all_time',
  currentCycleTouchIds = [],
  selectedTouchId,
  touchOutcomes = [],
  onDataChanged,
  className,
  showOutcomeControls = true,
}: {
  farm: Farm;
  addresses: FarmAddress[];
  linkedCampaignId?: string | null;
  layerScope?: MapLayerScope;
  currentCycleTouchIds?: string[];
  selectedTouchId?: string | null;
  touchOutcomes?: FarmTouchAddress[];
  onDataChanged?: () => void | Promise<void>;
  className?: string;
  showOutcomeControls?: boolean;
}) {
  const polygon = useMemo(() => parseFarmPolygon(farm), [farm]);
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [savingStatus, setSavingStatus] = useState<FarmAddressOutcomeStatus | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const latestOutcomeByAddress = useMemo(() => {
    const map = new Map<string, FarmTouchAddress>();
    for (const outcome of touchOutcomes) {
      if (!map.has(outcome.farm_address_id)) {
        map.set(outcome.farm_address_id, outcome);
      }
    }
    return map;
  }, [touchOutcomes]);

  const currentCycleOutcomeByAddress = useMemo(() => {
    const map = new Map<string, FarmTouchAddress>();
    if (currentCycleTouchIds.length === 0) return map;
    const touchIdSet = new Set(currentCycleTouchIds);
    for (const outcome of touchOutcomes) {
      if (!touchIdSet.has(outcome.farm_touch_id)) continue;
      if (!map.has(outcome.farm_address_id)) {
        map.set(outcome.farm_address_id, outcome);
      }
    }
    return map;
  }, [currentCycleTouchIds, touchOutcomes]);

  const selectedSessionOutcomeByAddress = useMemo(() => {
    const map = new Map<string, FarmTouchAddress>();
    if (!selectedTouchId) return map;
    for (const outcome of touchOutcomes) {
      if (outcome.farm_touch_id !== selectedTouchId) continue;
      if (!map.has(outcome.farm_address_id)) {
        map.set(outcome.farm_address_id, outcome);
      }
    }
    return map;
  }, [selectedTouchId, touchOutcomes]);

  const campaignAddresses = useMemo<CampaignAddress[]>(
    () =>
      addresses.map((address) => {
        const scopedOutcome =
          layerScope === 'current_cycle'
            ? currentCycleOutcomeByAddress.get(address.id)
            : layerScope === 'session'
              ? selectedSessionOutcomeByAddress.get(address.id)
              : latestOutcomeByAddress.get(address.id);

        const visitedAllTime = Number(address.visited_count ?? 0) > 0;
        const visitedInCycle =
          layerScope === 'current_cycle'
            ? Boolean(address.last_touch_id && currentCycleTouchIds.includes(address.last_touch_id))
            : false;
        const visitedInSelectedSession =
          layerScope === 'session' && selectedTouchId
            ? address.last_touch_id === selectedTouchId
            : false;

        const fallbackVisited =
          layerScope === 'current_cycle'
            ? visitedInCycle
            : layerScope === 'session'
              ? visitedInSelectedSession
              : visitedAllTime;
        const isVisited = scopedOutcome
          ? VISITED_OUTCOME_STATUSES.has(scopedOutcome.status)
          : fallbackVisited;
        const scopedStatus = scopedOutcome?.status ?? address.last_outcome_status ?? (isVisited ? 'delivered' : 'none');

        return {
          id: address.campaign_address_id ?? address.id,
          campaign_id: linkedCampaignId ?? '',
          address: address.formatted,
          formatted: address.formatted,
          postal_code: address.postal_code ?? undefined,
          source: 'map',
          gers_id: address.gers_id,
          visited: isVisited,
          address_status: scopedStatus,
          coordinate: address.coordinate,
          geom: address.geom ?? undefined,
          created_at: address.created_at,
          house_number: address.house_number ?? undefined,
          street_name: address.street_name ?? undefined,
          locality: address.locality ?? undefined,
          region: address.region ?? undefined,
          scans: isVisited ? (layerScope === 'all_time' ? address.visited_count ?? 1 : 1) : 0,
          last_scanned_at: isVisited ? (scopedOutcome?.occurred_at ?? address.last_visited_at ?? undefined) : undefined,
        };
      }),
    [
      addresses,
      currentCycleOutcomeByAddress,
      currentCycleTouchIds,
      latestOutcomeByAddress,
      layerScope,
      linkedCampaignId,
      selectedSessionOutcomeByAddress,
      selectedTouchId,
    ]
  );

  const linkedCampaign = useMemo<CampaignV2 | null>(() => {
    if (!linkedCampaignId) return null;
    return {
      id: linkedCampaignId,
      owner_id: farm.owner_id,
      workspace_id: farm.workspace_id ?? null,
      name: farm.name,
      type: 'door_knock',
      address_source: 'map',
      total_flyers: 0,
      scans: 0,
      conversions: 0,
      created_at: farm.created_at,
      status: farm.is_active === false ? 'paused' : 'active',
      description: farm.description ?? undefined,
      territory_boundary: polygon ?? undefined,
      campaign_polygon_snapped: polygon ?? undefined,
    };
  }, [farm, linkedCampaignId, polygon]);

  if (!linkedCampaignId || !linkedCampaign) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-xl border border-border bg-muted/20 text-sm text-muted-foreground">
        Linked campaign map is not available for this farm yet.
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden rounded-xl border border-border ${className ?? 'h-[520px]'}`}>
      <CampaignDetailMapView
        campaignId={linkedCampaignId}
        addresses={campaignAddresses}
        campaign={linkedCampaign}
        renderLocationCardExtra={showOutcomeControls ? ({ selectedAddressId }) => {
          const selectedFarmAddress =
            addresses.find((address) => address.campaign_address_id === selectedAddressId) ??
            addresses.find((address) => address.id === selectedAddressId) ??
            null;
          const sessionSelected = Boolean(selectedTouchId);

          const saveOutcome = async (status: FarmAddressOutcomeStatus) => {
            if (!sessionSelected || !selectedFarmAddress || savingStatus) return;
            setSavingStatus(status);
            setSaveError(null);
            try {
              await FarmTouchOutcomeService.recordOutcome({
                farmId: farm.id,
                farmTouchId: selectedTouchId!,
                farmAddressId: selectedFarmAddress.id,
                campaignAddressId: selectedFarmAddress.campaign_address_id ?? selectedAddressId ?? null,
                status,
                notes: outcomeNotes || null,
              });
              setOutcomeNotes('');
              await onDataChanged?.();
            } catch (error) {
              setSaveError(error instanceof Error ? error.message : 'Failed to save farm outcome');
            } finally {
              setSavingStatus(null);
            }
          };

          return (
            <div className="space-y-3 rounded-xl border border-gray-200/70 bg-gray-50/90 p-3 dark:border-white/10 dark:bg-white/5">
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Farm Session Outcome</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {sessionSelected
                    ? selectedFarmAddress
                      ? 'Save this address against the selected farm session.'
                      : 'Select a specific address in this building to save a session outcome.'
                    : 'Switch the map to Session mode to save per-session address outcomes.'}
                </p>
              </div>
              <Textarea
                value={outcomeNotes}
                onChange={(event) => setOutcomeNotes(event.target.value)}
                placeholder="Optional notes for this farm session..."
                rows={2}
                className="resize-none bg-white/90 text-gray-900 dark:bg-zinc-900/80 dark:text-gray-100"
                disabled={!sessionSelected || !selectedFarmAddress || Boolean(savingStatus)}
              />
              <div className="grid grid-cols-2 gap-2">
                {MAP_OUTCOME_ACTIONS.map((action) => (
                  <Button
                    key={action.status}
                    type="button"
                    size="sm"
                    variant={action.status === 'none' ? 'outline' : 'secondary'}
                    disabled={!sessionSelected || !selectedFarmAddress || Boolean(savingStatus)}
                    onClick={() => void saveOutcome(action.status)}
                  >
                    {savingStatus === action.status ? 'Saving...' : action.label}
                  </Button>
                ))}
              </div>
              {saveError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
              ) : null}
            </div>
          );
        } : undefined}
      />
    </div>
  );
}
