import type { CanonicalTileBundle, CanonicalMapRecord } from './canonicalTileBundle';
import { getCampaignAddressMapStatus } from '@/lib/campaignStats';
import type { CampaignAddress } from '@/types/database';
import { DEFAULT_STATUS_FILTERS, MAP_STATUS_CONFIG, MAP_STATUS_PRIORITY, normalizeAddressStatus,
  getMapUntouchedColor, type MapStatusKey, type StatusFilters } from '@/lib/constants/mapStatus';

export type CanonicalRenderState = { color: string; selected: boolean; hidden: boolean; status: MapStatusKey; teammate_owned: boolean };
export type CanonicalStateWrite = { sourceLayer: string; id: string; state: CanonicalRenderState };
export function statusKey(status: string, scanned = false): MapStatusKey {
  if (scanned) return 'QR_SCANNED';
  switch (normalizeAddressStatus(status)) {
    case 'appointment': case 'follow_up': case 'appointment_set': case 'callback_requested': case 'future_seller': return 'HOT_LEADS';
    case 'lead': case 'interested': case 'hot_lead': return 'LEADS';
    case 'talked': case 'conversation': case 'spoke': return 'CONVERSATIONS';
    case 'do_not_knock': case 'dnc': return 'DO_NOT_KNOCK';
    case 'no_answer': case 'not_home': case 'attempted': return 'NO_ONE_HOME';
    case 'delivered': case 'visited': return 'TOUCHED';
    default: return 'UNTOUCHED';
  }
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(String)
  : typeof value === 'string' && value ? [value] : [];

/** This joins state to canonical IDs, never to currently loaded tile fragments. */
export function canonicalTileStates(bundle: CanonicalTileBundle, addresses: CampaignAddress[], options: {
  selectedIds?: string[]; hiddenBuildingIds?: string[]; deletedAddressIds?: string[];
  visibleAddressIds?: string[]; filters?: StatusFilters; dark?: boolean;
  colorOverrides?: Record<string, string>;
} = {}): CanonicalStateWrite[] {
  const byAddress = new Map(addresses.map((address) => [address.id.toLowerCase(), address]));
  const byBuilding = new Map<string, Set<string>>();
  for (const raw of bundle.links) {
    const link = raw as Record<string, unknown>;
    if (!link.building_id || !link.address_id) continue;
    const id = String(link.building_id);
    if (!byBuilding.has(id)) byBuilding.set(id, new Set());
    byBuilding.get(id)!.add(String(link.address_id));
  }
  const selected = new Set(options.selectedIds ?? []);
  const deleted = new Set((options.deletedAddressIds ?? []).map((id) => id.toLowerCase()));
  const hiddenBuildings = new Set(options.hiddenBuildingIds ?? []);
  const visible = options.visibleAddressIds ? new Set(options.visibleAddressIds.map((id) => id.toLowerCase())) : null;
  const filters = options.filters ?? DEFAULT_STATUS_FILTERS;
  const stateFor = (record: CanonicalMapRecord, kind: 'address' | 'building' | 'parcel'): CanonicalRenderState => {
    const linked = kind === 'address' ? [record.id] : [...new Set([
      ...strings(record.properties.linked_address_ids), ...strings(record.properties.address_id),
      ...(kind === 'building' ? [...(byBuilding.get(record.id) ?? [])] : []),
    ])];
    const active = linked.filter((id) => !deleted.has(id.toLowerCase()));
    const live = active.flatMap((id) => byAddress.get(id.toLowerCase()) ?? []);
    const keys = live.map((address) => statusKey(getCampaignAddressMapStatus(address), Number(address.scans ?? 0) > 0 || Boolean(address.last_scanned_at)));
    const key = MAP_STATUS_PRIORITY.find((candidate) => keys.includes(candidate) && filters[candidate]) ?? 'UNTOUCHED';
    const teammate = live.some((address) => address.is_teammate_owned);
    const override = active.map((id) => options.colorOverrides?.[id]).find(Boolean);
    return {
      status: key,
      color: override ?? (teammate ? '#166534' : key === 'UNTOUCHED' ? getMapUntouchedColor(Boolean(options.dark)) : MAP_STATUS_CONFIG[key].color),
      teammate_owned: teammate,
      selected: selected.has(record.id) || selected.has(String(record.properties.row_id ?? '')) || selected.has(record.feature_id) || active.some((id) => selected.has(id)),
      hidden: (kind === 'building' && hiddenBuildings.has(record.id))
        || (linked.length > 0 && active.length === 0)
        || Boolean(visible && !active.some((id) => visible.has(id.toLowerCase()))),
    };
  };
  const writes: CanonicalStateWrite[] = [];
  for (const [name, kind] of [['buildings', 'building'], ['addresses', 'address'], ['parcels', 'parcel']] as const) {
    for (const record of bundle.records[name]) {
      const state = stateFor(record, kind);
      writes.push({ sourceLayer: name, id: record.feature_id, state });
      if (kind === 'address') {
        writes.push({ sourceLayer: 'address_circles', id: record.feature_id, state });
        if (bundle.tiles.layers.building_units) writes.push({ sourceLayer: 'building_units', id: record.feature_id, state });
      }
    }
  }
  return writes;
}

/** Diffed writes replay after a source/style reset without rebuilding geometry. */
export class CanonicalTileStateDiff {
  private applied = new Map<string, string>();
  reset() { this.applied.clear(); }
  apply(writes: CanonicalStateWrite[], send: (write: CanonicalStateWrite) => void) {
    for (const write of writes) {
      const key = `${write.sourceLayer}/${write.id}`;
      const value = JSON.stringify(write.state);
      if (this.applied.get(key) === value) continue;
      send(write);
      this.applied.set(key, value);
    }
  }
}
