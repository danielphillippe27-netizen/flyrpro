import {
  defaultTitleForEventType,
  EVENT_TYPE_META,
  isCalendarColorKey,
  isCalendarEventType,
} from './helpers';
import type { CalendarColorKey, CalendarEventRow, CalendarEventType } from './types';

export type CalendarEventPayloadInput = {
  title?: unknown;
  start_at?: unknown;
  end_at?: unknown;
  is_all_day?: unknown;
  event_type?: unknown;
  contact_id?: unknown;
  contact_name?: unknown;
  contact_address?: unknown;
  notes?: unknown;
  location?: unknown;
  color_key?: unknown;
};

export type NormalizedCalendarEventPayload = {
  title: string;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  event_type: CalendarEventType;
  contact_id: string | null;
  contact_name: string | null;
  contact_address: string | null;
  notes: string | null;
  location: string | null;
  color_key: CalendarColorKey;
};

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new Error(`${field} is required`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be a valid date`);
  }
  return date;
}

export function normalizeCalendarEventPayload(
  input: CalendarEventPayloadInput,
  existing?: CalendarEventRow
): NormalizedCalendarEventPayload {
  const rawEventType = optionalString(input.event_type) ?? existing?.event_type ?? 'appointment';
  const eventType = isCalendarEventType(rawEventType) ? rawEventType : 'appointment';
  const contactName = optionalString(input.contact_name) ?? existing?.contact_name ?? null;
  const title = optionalString(input.title) ?? existing?.title ?? defaultTitleForEventType(eventType, contactName);
  const startAt = parseDate(input.start_at ?? existing?.start_at, 'start_at');
  const fallbackDurationMinutes = EVENT_TYPE_META[eventType].defaultMinutes;
  const fallbackEnd = new Date(startAt.getTime() + fallbackDurationMinutes * 60000);
  let endAt = input.end_at !== undefined || existing?.end_at
    ? parseDate(input.end_at ?? existing?.end_at, 'end_at')
    : fallbackEnd;
  const minimumEnd = new Date(startAt.getTime() + 15 * 60000);
  if (endAt < minimumEnd) endAt = minimumEnd;

  const rawColorKey = optionalString(input.color_key) ?? existing?.color_key ?? EVENT_TYPE_META[eventType].defaultColorKey;
  const colorKey = isCalendarColorKey(rawColorKey) ? rawColorKey : EVENT_TYPE_META[eventType].defaultColorKey;
  const location = optionalString(input.location) ?? existing?.location ?? optionalString(input.contact_address) ?? existing?.contact_address ?? null;

  return {
    title,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    is_all_day: typeof input.is_all_day === 'boolean' ? input.is_all_day : existing?.is_all_day ?? false,
    event_type: eventType,
    contact_id: optionalString(input.contact_id) ?? existing?.contact_id ?? null,
    contact_name: contactName,
    contact_address: optionalString(input.contact_address) ?? existing?.contact_address ?? null,
    notes: optionalString(input.notes) ?? existing?.notes ?? null,
    location,
    color_key: colorKey,
  };
}
