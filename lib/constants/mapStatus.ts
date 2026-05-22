// Map Status Configuration
// Defines status systems for both building map and address map. See docs/MAP_STATUS_QUICK_REFERENCE.md.

// ----- Building / session map (building_stats) -----
// Table: building_stats, Column: status
// Campaign map: slate = unvisited, coral = attempted, green = talked to person,
// blue = lead, gold = appointment / follow-up,
// purple = QR scan, black = do not knock.

export type MapStatusKey =
  | 'QR_SCANNED'
  | 'CONVERSATIONS'
  | 'LEADS'
  | 'HOT_LEADS'
  | 'TOUCHED'
  | 'NO_ONE_HOME'
  | 'DO_NOT_KNOCK'
  | 'UNTOUCHED';

export interface MapStatusConfig {
  key: MapStatusKey;
  label: string;
  color: string;
}

/**
 * Building map status config.
 * Priority: QR_SCANNED > HOT_LEADS > LEADS > CONVERSATIONS > DO_NOT_KNOCK > NO_ONE_HOME > TOUCHED > UNTOUCHED.
 */
export const MAP_STATUS_CONFIG: Record<MapStatusKey, MapStatusConfig> = {
  QR_SCANNED: {
    key: 'QR_SCANNED',
    label: 'QR Code Scanned',
    color: '#8b5cf6',
  },
  CONVERSATIONS: {
    key: 'CONVERSATIONS',
    label: 'Talked to person',
    color: '#22c55e',
  },
  LEADS: {
    key: 'LEADS',
    label: 'Lead',
    color: '#3b82f6',
  },
  HOT_LEADS: {
    key: 'HOT_LEADS',
    label: 'Appointment / follow-up',
    color: '#facc15',
  },
  TOUCHED: {
    key: 'TOUCHED',
    label: 'Attempted',
    color: '#f87171',
  },
  NO_ONE_HOME: {
    key: 'NO_ONE_HOME',
    label: 'Attempted',
    color: '#f87171',
  },
  DO_NOT_KNOCK: {
    key: 'DO_NOT_KNOCK',
    label: 'Do not knock',
    color: '#000000',
  },
  UNTOUCHED: {
    key: 'UNTOUCHED',
    label: 'Unvisited',
    color: '#475569',
  },
} as const;

// ----- Address map (address_statuses) -----
// Table: address_statuses, Column: status
// Door-knock address colors follow the shared campaign map palette.

export type AddressStatusValue =
  | 'none'
  | 'no_answer'
  | 'delivered'
  | 'talked'
  | 'lead'
  | 'interested'
  | 'appointment'
  | 'follow_up'
  | 'appointment_set'
  | 'callback_requested'
  | 'do_not_knock'
  | 'future_seller'
  | 'hot_lead';

/** Map address_status to display label (optional, for UI). */
export const ADDRESS_STATUS_LABELS: Record<AddressStatusValue, string> = {
  none: 'None',
  no_answer: 'Attempted',
  delivered: 'Attempted',
  talked: 'Talked to person',
  lead: 'Lead',
  interested: 'Lead',
  appointment: 'Appointment',
  follow_up: 'Follow up',
  appointment_set: 'Appointment',
  callback_requested: 'Follow up',
  do_not_knock: 'Do not knock',
  future_seller: 'Follow up',
  hot_lead: 'Lead',
};

/** Address map colors follow the shared campaign map palette. */
export const ADDRESS_STATUS_COLORS: Record<string, string> = {
  not_home: MAP_STATUS_CONFIG.NO_ONE_HOME.color,
  attempted: MAP_STATUS_CONFIG.NO_ONE_HOME.color,
  no_answer: MAP_STATUS_CONFIG.NO_ONE_HOME.color,
  delivered: MAP_STATUS_CONFIG.TOUCHED.color,
  talked: MAP_STATUS_CONFIG.CONVERSATIONS.color,
  lead: MAP_STATUS_CONFIG.LEADS.color,
  interested: MAP_STATUS_CONFIG.LEADS.color,
  appointment: MAP_STATUS_CONFIG.HOT_LEADS.color,
  follow_up: MAP_STATUS_CONFIG.HOT_LEADS.color,
  appointment_set: MAP_STATUS_CONFIG.HOT_LEADS.color,
  callback_requested: MAP_STATUS_CONFIG.HOT_LEADS.color,
  do_not_knock: MAP_STATUS_CONFIG.DO_NOT_KNOCK.color,
  future_seller: MAP_STATUS_CONFIG.HOT_LEADS.color,
  hot_lead: MAP_STATUS_CONFIG.LEADS.color,
};
const ADDRESS_MAP_DEFAULT_COLOR = MAP_STATUS_CONFIG.UNTOUCHED.color;

export function getAddressStatusColor(status: string | undefined | null): string {
  if (!status) return ADDRESS_MAP_DEFAULT_COLOR;
  return ADDRESS_STATUS_COLORS[status] ?? ADDRESS_MAP_DEFAULT_COLOR;
}

/** True if address status should show as blue (lead). */
export function isAddressStatusBlue(status: string | undefined | null): boolean {
  return status === 'lead' || status === 'interested' || status === 'hot_lead';
}

/** True if address status should show as green (talked to person). */
export function isAddressStatusGreen(status: string | undefined | null): boolean {
  return status === 'talked';
}

/**
 * Status keys in priority order (for filter logic)
 */
export const MAP_STATUS_PRIORITY: MapStatusKey[] = [
  'QR_SCANNED',
  'HOT_LEADS',
  'LEADS',
  'CONVERSATIONS',
  'DO_NOT_KNOCK',
  'NO_ONE_HOME',
  'TOUCHED',
  'UNTOUCHED',
];

/**
 * Default filter state with all statuses enabled
 */
export const DEFAULT_STATUS_FILTERS: Record<MapStatusKey, boolean> = {
  QR_SCANNED: true,
  CONVERSATIONS: true,
  LEADS: true,
  HOT_LEADS: true,
  TOUCHED: true,
  NO_ONE_HOME: true,
  DO_NOT_KNOCK: true,
  UNTOUCHED: true,
};

/**
 * Type for status filter state
 */
export type StatusFilters = Record<MapStatusKey, boolean>;
