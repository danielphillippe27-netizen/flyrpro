// Map Status Configuration
// Defines the unified status system for building visualization on the map

export type MapStatusKey = 'QR_SCANNED' | 'CONVERSATIONS' | 'TOUCHED' | 'UNTOUCHED';

export interface MapStatusConfig {
  key: MapStatusKey;
  label: string;
  color: string;
}

/**
 * Unified status configuration for map buildings
 * Priority order (highest to lowest): QR_SCANNED > CONVERSATIONS > TOUCHED > UNTOUCHED
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
    color: '#3b82f6', // Blue
  },
  TOUCHED: {
    key: 'TOUCHED',
    label: 'Touched',
    color: '#22c55e', // Green
  },
  UNTOUCHED: {
    key: 'UNTOUCHED',
    label: 'Untouched',
    color: '#ef4444', // Red
  },
} as const;

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
