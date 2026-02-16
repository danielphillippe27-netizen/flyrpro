// Map Status Configuration
// Defines status systems for both building map and address map. See docs/MAP_STATUS_QUICK_REFERENCE.md.

// ----- Building / session map (building_stats) -----
// Table: building_stats, Column: status
// Green = visited (touched/knocked), Blue = hot (conversation), Red = not_visited

export type MapStatusKey = 'QR_SCANNED' | 'CONVERSATIONS' | 'TOUCHED' | 'UNTOUCHED';

export interface MapStatusConfig {
  key: MapStatusKey;
  label: string;
  color: string;
}

/**
 * Building map status config. Raw DB values: not_visited | visited | hot.
 * Priority: QR_SCANNED > CONVERSATIONS (hot) > TOUCHED (visited) > UNTOUCHED (not_visited).
 */
export const MAP_STATUS_CONFIG: Record<MapStatusKey, MapStatusConfig> = {
  QR_SCANNED: {
    key: 'QR_SCANNED',
    label: 'QR Code Scanned',
    color: '#a855f7', // Purple
  },
  CONVERSATIONS: {
    key: 'CONVERSATIONS',
    label: 'Conversations',
    color: '#3b82f6', // Blue — building_stats.status = 'hot'
  },
  TOUCHED: {
    key: 'TOUCHED',
    label: 'Touched',
    color: '#22c55e', // Green — building_stats.status = 'visited'
  },
  UNTOUCHED: {
    key: 'UNTOUCHED',
    label: 'Untouched',
    color: '#ef4444', // Red — building_stats.status = 'not_visited'
  },
} as const;

// ----- Address map (address_statuses) -----
// Table: address_statuses, Column: status
// Green = delivered, Blue = talked | appointment

export type AddressStatusValue =
  | 'none'
  | 'no_answer'
  | 'delivered'
  | 'talked'
  | 'appointment'
  | 'do_not_knock'
  | 'future_seller'
  | 'hot_lead';

/** Map address_status to display label (optional, for UI). */
export const ADDRESS_STATUS_LABELS: Record<AddressStatusValue, string> = {
  none: 'None',
  no_answer: 'No answer',
  delivered: 'Delivered',
  talked: 'Talked',
  appointment: 'Appointment',
  do_not_knock: 'Do not knock',
  future_seller: 'Future seller',
  hot_lead: 'Hot lead',
};

/** Address map colors: green = delivered, blue = talked/appointment, red = rest. */
export const ADDRESS_STATUS_COLORS: Record<string, string> = {
  delivered: '#22c55e',   // Green
  talked: '#3b82f6',      // Blue
  appointment: '#3b82f6', // Blue
};
const ADDRESS_MAP_DEFAULT_COLOR = '#ef4444'; // Red for none, no_answer, etc.

export function getAddressStatusColor(status: string | undefined | null): string {
  if (!status) return ADDRESS_MAP_DEFAULT_COLOR;
  return ADDRESS_STATUS_COLORS[status] ?? ADDRESS_MAP_DEFAULT_COLOR;
}

/** True if address status should show as blue (conversation). */
export function isAddressStatusBlue(status: string | undefined | null): boolean {
  return status === 'talked' || status === 'appointment';
}

/** True if address status should show as green (delivered). */
export function isAddressStatusGreen(status: string | undefined | null): boolean {
  return status === 'delivered';
}

/**
 * Status keys in priority order (for filter logic)
 */
export const MAP_STATUS_PRIORITY: MapStatusKey[] = [
  'QR_SCANNED',
  'CONVERSATIONS', 
  'TOUCHED',
  'UNTOUCHED',
];

/**
 * Default filter state with all statuses enabled
 */
export const DEFAULT_STATUS_FILTERS: Record<MapStatusKey, boolean> = {
  QR_SCANNED: true,
  CONVERSATIONS: true,
  TOUCHED: true,
  UNTOUCHED: true,
};

/**
 * Type for status filter state
 */
export type StatusFilters = Record<MapStatusKey, boolean>;
