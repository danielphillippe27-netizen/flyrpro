/** Absent preserves the current rollout; malformed values fail closed. */
export function fieldProcessingEnabled(value = process.env.FIELD_RECORDING_PROCESSING_ENABLED): boolean {
  return value === undefined || value === 'true';
}
/** Enable only after partner/device validation confirms a complete file-list readback. */
export function fieldPinDeletionEnabled(enabled = process.env.FIELD_RECORDING_PIN_DELETION_ENABLED, verified = process.env.PLAUD_PIN_FILE_LIST_COMPLETE): boolean {
  return enabled === 'true' && verified === 'true';
}
