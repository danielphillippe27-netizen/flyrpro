/**
 * Double-write utility for zero-downtime UUID migration
 * During migration phase, writes to both text and uuid shadow columns
 * 
 * Usage:
 *   const data = prepareDoubleWrite({ gers_id: '08b2...' });
 *   // data will include both gers_id and gers_id_uuid
 */

import { normalizeGersId } from './uuid';

/**
 * Configuration flag for double-write phase
 * Set to true when shadow columns are populated and ready for double-write
 */
export const ENABLE_DOUBLE_WRITE = process.env.ENABLE_UUID_DOUBLE_WRITE === 'true';

/**
 * Prepares data for double-write to both text and uuid columns
 * Returns object with both old and new column names
 */
export function prepareDoubleWrite<T extends Record<string, any>>(
  data: T,
  textColumn: 'gers_id' | 'source_id',
  uuidColumn: `${typeof textColumn}_uuid` = `${textColumn}_uuid` as any
): T & Partial<Record<typeof uuidColumn, string | null>> {
  if (!ENABLE_DOUBLE_WRITE) {
    // During normal operation, only write to text column
    return data;
  }

  // During double-write phase, write to both columns
  const textValue = data[textColumn];
  if (textValue !== undefined && textValue !== null) {
    const normalized = normalizeGersId(textValue);
    return {
      ...data,
      [uuidColumn]: normalized,
    };
  }

  return data;
}

/**
 * Prepares upsert data with double-write support
 */
export function prepareUpsertWithDoubleWrite<T extends Record<string, any>>(
  data: T | T[],
  textColumn: 'gers_id' | 'source_id'
): (T & Partial<Record<`${typeof textColumn}_uuid`, string | null>>)[] {
  const dataArray = Array.isArray(data) ? data : [data];
  return dataArray.map(item => prepareDoubleWrite(item, textColumn));
}
