/**
 * Feature Flags Configuration
 * 
 * Centralized feature toggles for gradual rollouts and safety switches.
 * All flags default to safe/production values.
 */

/**
 * Control whether building unit polygons are persisted to the database.
 * When false: Analysis runs but no units are saved (address linking only).
 * When true: Full townhouse splitting with unit persistence (legacy behavior).
 * 
 * Default: false (disabled in production until v2 splitting is ready)
 */
export function isUnitPersistenceEnabled(): boolean {
  return process.env.ENABLE_UNIT_PERSISTENCE === 'true';
}

/**
 * Check if address is outside building footprint by more than threshold.
 * Used to flag addresses that may need manual review.
 */
export function getAddressOutsideThresholdMeters(): number {
  return parseFloat(process.env.ADDRESS_OUTSIDE_THRESHOLD_METERS || '10');
}
