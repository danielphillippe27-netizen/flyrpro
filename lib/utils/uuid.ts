/**
 * UUID validation and conversion utilities for Overture GERS IDs
 * GERS IDs are 128-bit UUIDs that may be stored as hex strings or hyphenated UUIDs
 */

/**
 * Validates if a string is a valid UUID format (with or without hyphens)
 */
export function isValidUuid(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();

  // UUID format with hyphens: 8-4-4-4-12
  const uuidWithHyphens = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidWithHyphens.test(trimmed)) {
    return true;
  }

  // Pure hex string (32 characters)
  const pureHex = /^[0-9a-f]{32}$/i;
  if (pureHex.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Converts a hex string to UUID format (adds hyphens)
 * Input: "08b25a1b2c3d4e5f6a7b8c9d0e1f2a3b"
 * Output: "08b25a1b-2c3d-4e5f-6a7b-8c9d0e1f2a3b"
 */
export function hexToUuidFormat(hexStr: string | null | undefined): string | null {
  if (!hexStr || typeof hexStr !== 'string') {
    return null;
  }

  const trimmed = hexStr.trim().toLowerCase();

  // If already in UUID format, return as-is
  if (isValidUuid(trimmed) && trimmed.includes('-')) {
    return trimmed;
  }

  // Remove any existing hyphens and non-hex characters
  const cleanHex = trimmed.replace(/[^0-9a-f]/g, '');

  // Must be exactly 32 characters
  if (cleanHex.length !== 32) {
    return null;
  }

  // Format as UUID: 8-4-4-4-12
  return `${cleanHex.substring(0, 8)}-${cleanHex.substring(8, 12)}-${cleanHex.substring(12, 16)}-${cleanHex.substring(16, 20)}-${cleanHex.substring(20, 32)}`;
}

/**
 * Normalizes a GERS ID to UUID format
 * Handles both hex strings and already-formatted UUIDs
 */
export function normalizeGersId(gersId: string | null | undefined): string | null {
  if (!gersId) {
    return null;
  }

  const formatted = hexToUuidFormat(gersId);
  if (!formatted) {
    return null;
  }

  return formatted;
}

/**
 * Validates a GERS ID and throws if invalid
 * Useful for API route validation
 */
export function validateGersId(gersId: string | null | undefined, fieldName: string = 'GERS ID'): string {
  if (!gersId) {
    throw new Error(`${fieldName} is required`);
  }

  const normalized = normalizeGersId(gersId);
  if (!normalized) {
    throw new Error(`${fieldName} must be a valid UUID format (received: ${gersId})`);
  }

  return normalized;
}

/**
 * Type guard to check if a value is a valid GERS ID
 */
export function isGersId(value: unknown): value is string {
  return typeof value === 'string' && isValidUuid(value);
}
