'use client';

import { useState } from 'react';
import { CampaignDetailMapView, type MapPointOverlay } from '@/components/campaigns/CampaignDetailMapView';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FarmTouchOutcomeService } from '@/lib/services/FarmService';
import type {
  CampaignAddress,
  CampaignV2,
  Contact,
  Farm,
  FarmAddress,
  FarmAddressOutcomeStatus,
  FarmTouchAddress,
} from '@/types/database';

type MapLayerScope = 'all_time' | 'cycle';
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
  { status: 'no_answer', label: 'Attempted' },
  { status: 'talked', label: 'Conversation' },
  { status: 'do_not_knock', label: 'DNC' },
  { status: 'none', label: 'Reset' },
];

export function FarmMapView({
  farm,
  addresses,
  linkedCampaignId,
  linkedCampaign,
  layerScope = 'all_time',
  cycleTouchIds = [],
  selectedTouchId,
  touchOutcomes = [],
  contacts = [],
  showContactsOverlay = false,
  onDataChanged,
  className,
  showOutcomeControls = true,
}: {
  farm: Farm;
  addresses: FarmAddress[];
  linkedCampaignId?: string | null;
  linkedCampaign?: CampaignV2 | null;
  layerScope?: MapLayerScope;
  cycleTouchIds?: string[];
  selectedTouchId?: string | null;
  touchOutcomes?: FarmTouchAddress[];
  contacts?: Contact[];
  showContactsOverlay?: boolean;
  onDataChanged?: () => void | Promise<void>;
  className?: string;
  showOutcomeControls?: boolean;
}) {
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
    if (cycleTouchIds.length === 0) return map;
    const touchIdSet = new Set(cycleTouchIds);
    for (const outcome of touchOutcomes) {
      if (!touchIdSet.has(outcome.farm_touch_id)) continue;
      if (!map.has(outcome.farm_address_id)) {
        map.set(outcome.farm_address_id, outcome);
      }
    }
    return map;
  }, [cycleTouchIds, touchOutcomes]);

  const campaignAddresses = useMemo<CampaignAddress[]>(
    () =>
      addresses.map((address) => {
        const scopedOutcome =
          layerScope === 'cycle'
            ? currentCycleOutcomeByAddress.get(address.id)
            : latestOutcomeByAddress.get(address.id);

        const visitedAllTime = Number(address.visited_count ?? 0) > 0;
        // Scoped map slices must be driven by canonical per-touch outcomes only.
        // Using denormalized `last_touch_id` here can leak stale/legacy state from
        // earlier iterations into a cycle/session that did not actually record an
        // outcome for this house.
        const isVisited =
          layerScope === 'all_time'
            ? (scopedOutcome
                ? VISITED_OUTCOME_STATUSES.has(scopedOutcome.status)
                : visitedAllTime)
            : Boolean(scopedOutcome && VISITED_OUTCOME_STATUSES.has(scopedOutcome.status));
        const scopedStatus =
          scopedOutcome?.status ??
          (layerScope === 'all_time' ? address.last_outcome_status : null) ??
          (isVisited ? 'delivered' : 'none');

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
          // Farm touch history is not the same thing as QR scans. If we synthesize
          // scans from visited_count / touched outcomes, the shared map color logic
          // promotes those homes to the QR-scanned purple state.
          scans: 0,
          last_scanned_at: undefined,
        };
      }),
    [
      addresses,
      currentCycleOutcomeByAddress,
      latestOutcomeByAddress,
      layerScope,
      linkedCampaignId,
    ]
  );

  const contactOverlays = useMemo<MapPointOverlay[]>(() => {
    if (!showContactsOverlay) return [];

    const addressById = new Map(addresses.map((address) => [address.id, address]));
    const addressByCampaignAddressId = new Map(
      addresses
        .filter((address) => address.campaign_address_id)
        .map((address) => [address.campaign_address_id!, address])
    );
    const addressIdsBySearchCandidate = new Map<string, Set<string>>();

    for (const address of addresses) {
      for (const candidate of [
        address.formatted,
        address.postal_code,
        address.house_number && address.street_name ? `${address.house_number} ${address.street_name}` : null,
        address.locality,
        address.region,
      ]) {
        const normalized = candidate?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!normalized) continue;
        const ids = addressIdsBySearchCandidate.get(normalized) ?? new Set<string>();
        ids.add(address.id);
        addressIdsBySearchCandidate.set(normalized, ids);
      }
    }

    const contactsByAddressId = new Map<string, Contact[]>();

    for (const contact of contacts) {
      const matchedAddressIds = new Set<string>();

      if (contact.address_id && addressByCampaignAddressId.has(contact.address_id)) {
        matchedAddressIds.add(addressByCampaignAddressId.get(contact.address_id)!.id);
      }

      const normalizedAddress = contact.address?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (normalizedAddress) {
        addressIdsBySearchCandidate.get(normalizedAddress)?.forEach((addressId) => matchedAddressIds.add(addressId));
      }

      matchedAddressIds.forEach((addressId) => {
        const existing = contactsByAddressId.get(addressId) ?? [];
        if (!existing.some((entry) => entry.id === contact.id)) {
          existing.push(contact);
          contactsByAddressId.set(addressId, existing);
        }
      });
    }

    return Array.from(contactsByAddressId.entries())
      .map(([addressId, matchedContacts]) => {
        const address = addressById.get(addressId);
        const coordinate = address?.coordinate;
        if (!address || !coordinate || matchedContacts.length === 0) return null;

        return {
          id: `farm-contact:${addressId}`,
          lon: coordinate.lon,
          lat: coordinate.lat,
          addressId: address.campaign_address_id ?? address.id,
          buildingId: address.gers_id ?? address.campaign_address_id ?? address.id,
          count: matchedContacts.length,
          label: matchedContacts.length > 1 ? String(matchedContacts.length) : null,
          color: '#dc2626',
        } satisfies MapPointOverlay;
      })
      .filter((overlay): overlay is MapPointOverlay => Boolean(overlay));
  }, [addresses, contacts, showContactsOverlay]);

  if (!linkedCampaignId) {
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
        pointOverlays={contactOverlays}
        buildingPendingOverlay={{
          title: 'Rendering farm map',
          description: 'Big farms can take a little longer to render. Buildings will appear as the map finishes loading.',
        }}
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
                    : 'Select a farm session before saving per-session address outcomes.'}
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
