import {
  addDays,
  addMinutes,
  addMonths,
  addYears,
  endOfDay,
  format,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfYear,
} from 'date-fns';
import type {
  CalendarColorKey,
  CalendarDayCell,
  CalendarEventRow,
  CalendarEventType,
  CalendarItem,
  CalendarTimedEventLayout,
} from './types';

export const CALENDAR_EVENT_TYPES: CalendarEventType[] = [
  'appointment',
  'follow_up',
  'session',
  'showing',
  'call',
  'task',
  'personal',
];

export const CALENDAR_COLOR_KEYS: CalendarColorKey[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'pink',
  'gray',
];

export const EVENT_TYPE_META: Record<
  CalendarEventType,
  { label: string; defaultColorKey: CalendarColorKey; defaultMinutes: number }
> = {
  appointment: { label: 'Appointment', defaultColorKey: 'red', defaultMinutes: 60 },
  follow_up: { label: 'Follow-Up', defaultColorKey: 'blue', defaultMinutes: 30 },
  session: { label: 'Session', defaultColorKey: 'green', defaultMinutes: 60 },
  showing: { label: 'Showing', defaultColorKey: 'green', defaultMinutes: 60 },
  call: { label: 'Call', defaultColorKey: 'purple', defaultMinutes: 30 },
  task: { label: 'Task', defaultColorKey: 'yellow', defaultMinutes: 30 },
  personal: { label: 'Personal', defaultColorKey: 'gray', defaultMinutes: 60 },
};

export const CALENDAR_COLOR_HEX: Record<CalendarColorKey, string> = {
  red: '#ff3b30',
  blue: '#0a84ff',
  green: '#34c759',
  yellow: '#ffcc1f',
  purple: '#af52de',
  pink: '#ff375f',
  gray: '#8e8e93',
};

export function isCalendarEventType(value: string): value is CalendarEventType {
  return CALENDAR_EVENT_TYPES.includes(value as CalendarEventType);
}

export function isCalendarColorKey(value: string): value is CalendarColorKey {
  return CALENDAR_COLOR_KEYS.includes(value as CalendarColorKey);
}

export function defaultTitleForEventType(eventType: CalendarEventType, contactName?: string | null): string {
  const label = EVENT_TYPE_META[eventType].label;
  return contactName?.trim() ? `${label}: ${contactName.trim()}` : label;
}

export function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function monthKey(date: Date): string {
  return format(date, 'yyyy-MM');
}

export function monthGrid(month: Date, firstDayOfWeek = 0): CalendarDayCell[] {
  const monthStart = startOfMonth(month);
  const leadingDays = (monthStart.getDay() - firstDayOfWeek + 7) % 7;
  const gridStart = addDays(monthStart, -leadingDays);

  return Array.from({ length: 42 }, (_, offset) => {
    const date = addDays(gridStart, offset);
    return {
      id: dateKey(startOfDay(date)),
      date,
      isInDisplayedMonth: isSameMonth(date, monthStart),
    };
  });
}

export function monthsInYear(date: Date): Date[] {
  const yearStart = startOfYear(date);
  return Array.from({ length: 12 }, (_, offset) => addMonths(yearStart, offset));
}

export function visibleRange(around: Date, monthsBefore = 6, monthsAfter = 6): { start: Date; end: Date } {
  const monthStart = startOfMonth(around);
  return {
    start: addMonths(monthStart, -monthsBefore),
    end: addMonths(monthStart, monthsAfter + 1),
  };
}

export function yearRange(around: Date): { start: Date; end: Date } {
  const yearStart = startOfYear(around);
  return {
    start: yearStart,
    end: addYears(yearStart, 1),
  };
}

export function dayRange(date: Date): { start: Date; end: Date } {
  return {
    start: startOfDay(date),
    end: addDays(startOfDay(date), 1),
  };
}

export function calendarItemIntersects(item: Pick<CalendarItem, 'startAt' | 'endAt'>, start: Date, end: Date): boolean {
  return item.endAt > start && item.startAt < end;
}

export function calendarEventIntersects(row: Pick<CalendarEventRow, 'start_at' | 'end_at'>, start: Date, end: Date): boolean {
  return new Date(row.end_at) > start && new Date(row.start_at) < end;
}

export function calendarItemFromRow(row: CalendarEventRow): CalendarItem {
  return {
    id: `event-${row.id}`,
    sourceId: row.id,
    kind: row.kind ?? 'standalone',
    eventType: row.event_type,
    title: row.title,
    startAt: new Date(row.start_at),
    endAt: new Date(row.end_at),
    isAllDay: row.is_all_day,
    notes: row.notes,
    location: row.location,
    colorKey: row.color_key,
    contactName: row.contact_name,
    contactId: row.contact_id,
    address: row.contact_address ?? row.location,
    displayName: row.display_name ?? null,
    row,
  };
}

export function calendarSearchHaystack(item: CalendarItem): string {
  return [
    item.title,
    item.notes ?? '',
    item.location ?? '',
    item.contactName ?? '',
    item.address ?? '',
    item.displayName ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export function itemsForDay(items: CalendarItem[], day: Date): CalendarItem[] {
  const range = dayRange(day);
  return items
    .filter((item) => calendarItemIntersects(item, range.start, range.end))
    .sort((lhs, rhs) => lhs.startAt.getTime() - rhs.startAt.getTime() || lhs.title.localeCompare(rhs.title));
}

export function itemsForMonth(items: CalendarItem[], month: Date): CalendarItem[] {
  const start = startOfMonth(month);
  const end = addMonths(start, 1);
  return items.filter((item) => calendarItemIntersects(item, start, end));
}

export function computeTimedEventLayouts(day: Date, items: CalendarItem[]): CalendarTimedEventLayout[] {
  const start = startOfDay(day);
  const end = addDays(start, 1);
  const timed = items
    .filter((item) => !item.isAllDay && calendarItemIntersects(item, start, end))
    .sort((lhs, rhs) => lhs.startAt.getTime() - rhs.startAt.getTime() || lhs.endAt.getTime() - rhs.endAt.getTime());

  let groupIndex = 0;
  const active: Array<{ item: CalendarItem; column: number }> = [];
  const results: Array<{ item: CalendarItem; column: number; group: number }> = [];
  const groupMaxColumn = new Map<number, number>();

  for (const item of timed) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].item.endAt <= item.startAt) active.splice(index, 1);
    }
    if (active.length === 0 && results.length > 0) groupIndex += 1;

    const used = new Set(active.map((entry) => entry.column));
    let column = 0;
    while (used.has(column)) column += 1;

    active.push({ item, column });
    results.push({ item, column, group: groupIndex });
    groupMaxColumn.set(groupIndex, Math.max(groupMaxColumn.get(groupIndex) ?? 0, column));
  }

  return results.map((entry) => {
    const clippedStart = new Date(Math.max(entry.item.startAt.getTime(), start.getTime()));
    const clippedEnd = new Date(Math.min(entry.item.endAt.getTime(), end.getTime()));
    const startMinute = Math.max(0, Math.floor((clippedStart.getTime() - start.getTime()) / 60000));
    const durationMinutes = Math.max(15, Math.floor((clippedEnd.getTime() - clippedStart.getTime()) / 60000));
    return {
      id: entry.item.id,
      item: entry.item,
      column: entry.column,
      columnCount: (groupMaxColumn.get(entry.group) ?? 0) + 1,
      startMinute,
      durationMinutes,
    };
  });
}

export function resolveTimelineSlot(options: {
  x: number;
  y: number;
  timelineWidth: number;
  gutterWidth: number;
  hourHeight: number;
  days: Date[];
  snapMinutes?: number;
}): Date | null {
  const { x, y, timelineWidth, gutterWidth, hourHeight, days, snapMinutes = 15 } = options;
  if (days.length === 0 || timelineWidth <= gutterWidth || hourHeight <= 0 || snapMinutes <= 0) return null;

  const boundedX = Math.max(gutterWidth, Math.min(x, timelineWidth));
  const dayWidth = Math.max(1, (timelineWidth - gutterWidth) / days.length);
  const rawDayIndex = Math.floor((boundedX - gutterWidth) / dayWidth);
  const dayIndex = Math.min(days.length - 1, Math.max(0, rawDayIndex));
  const rawMinutes = (Math.max(0, y) / hourHeight) * 60;
  const snappedMinutes = Math.min(
    23 * 60 + (60 - snapMinutes),
    Math.max(0, Math.round(rawMinutes / snapMinutes) * snapMinutes)
  );

  return addMinutes(startOfDay(days[dayIndex]), snappedMinutes);
}

export function isToday(date: Date): boolean {
  return dateKey(date) === dateKey(new Date());
}

export function endOfCalendarDay(date: Date): Date {
  return endOfDay(date);
}
