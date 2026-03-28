import type { CampaignAddress, CampaignContact } from '@/types/database';
import type { CampaignStats } from '@/lib/services/CampaignsService';

const VISITED_STATUSES = new Set([
  'no_answer',
  'delivered',
  'talked',
  'appointment',
  'do_not_knock',
  'future_seller',
  'hot_lead',
]);

const CONTACTED_STATUSES = new Set([
  'talked',
  'appointment',
  'future_seller',
  'hot_lead',
]);

function normalizeStatus(status?: string | null): string {
  return (status ?? '').trim().toLowerCase();
}

export function getCampaignAddressMapStatus(
  address: Pick<CampaignAddress, 'address_status' | 'visited'>
): string {
  const status = normalizeStatus(address.address_status);
  if (status) return status;
  return address.visited ? 'delivered' : 'none';
}

const ADDRESS_OUTCOME_LABELS: Record<string, string> = {
  none: 'Not visited',
  no_answer: 'No answer',
  delivered: 'Visited',
  talked: 'Conversation',
  appointment: 'Appointment',
  do_not_knock: 'Do not knock',
  future_seller: 'Future seller',
  hot_lead: 'Hot lead',
  qr_scanned: 'QR scanned',
};

function humanizeUnknownStatus(key: string): string {
  if (!key) return 'Unknown';
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Canonical status key + user-facing label for address lists (e.g. campaign Addresses table).
 * When there is no knock outcome but the QR was scanned, surface "QR scanned".
 */
export function getAddressRecipientsStatus(
  address: Pick<CampaignAddress, 'address_status' | 'visited' | 'scans'>
): { statusKey: string; label: string } {
  const key = getCampaignAddressMapStatus(address);
  const scans = Number(address.scans ?? 0);
  if (key === 'none' && scans > 0) {
    return { statusKey: 'qr_scanned', label: ADDRESS_OUTCOME_LABELS.qr_scanned };
  }
  const label = ADDRESS_OUTCOME_LABELS[key] ?? humanizeUnknownStatus(key);
  return { statusKey: key, label };
}

export function isVisitedCampaignAddress(address: Pick<CampaignAddress, 'address_status' | 'visited'>): boolean {
  const status = normalizeStatus(address.address_status);
  if (status) return VISITED_STATUSES.has(status);
  return Boolean(address.visited);
}

export function isContactedCampaignAddress(address: Pick<CampaignAddress, 'address_status' | 'visited'>): boolean {
  const status = normalizeStatus(address.address_status);
  if (status) return CONTACTED_STATUSES.has(status) || VISITED_STATUSES.has(status);
  return Boolean(address.visited);
}

export function getCampaignBuildingStatus(
  address: Pick<CampaignAddress, 'address_status' | 'visited'>
): 'not_visited' | 'visited' | 'hot' {
  const status = getCampaignAddressMapStatus(address);
  if (CONTACTED_STATUSES.has(status)) return 'hot';
  if (VISITED_STATUSES.has(status)) return 'visited';
  return 'not_visited';
}

export function getScannedAddressCount(addresses: CampaignAddress[]): number {
  return addresses.filter((address) => {
    const scans = Number(address.scans ?? 0);
    return scans > 0 || Boolean(address.last_scanned_at);
  }).length;
}

export function deriveCampaignStats(
  addresses: CampaignAddress[],
  contacts: CampaignContact[]
): CampaignStats {
  const totalAddresses = addresses.length;
  const visited = addresses.filter(isVisitedCampaignAddress).length;
  const contacted = addresses.filter(isContactedCampaignAddress).length;
  const scanned = getScannedAddressCount(addresses);

  return {
    addresses: totalAddresses,
    contacts: contacts.length,
    contacted,
    visited,
    scanned,
    scan_rate: totalAddresses > 0 ? Math.round((scanned / totalAddresses) * 100) : 0,
    progress_pct: totalAddresses > 0 ? Math.round((visited / totalAddresses) * 100) : 0,
  };
}
