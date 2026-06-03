export type CalendarEventType =
  | 'appointment'
  | 'follow_up'
  | 'session'
  | 'showing'
  | 'call'
  | 'task'
  | 'personal';

export type CalendarColorKey =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'pink'
  | 'gray';

export type CalendarItemKind = 'standalone' | 'reminder' | 'meeting' | 'session';

export type CalendarEventRow = {
  id: string;
  user_id: string | null;
  workspace_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  event_type: CalendarEventType | string;
  contact_id: string | null;
  contact_name: string | null;
  contact_address: string | null;
  source_kind: string | null;
  source_id: string | null;
  notes: string | null;
  location: string | null;
  color_key: CalendarColorKey | string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  display_name?: string | null;
  kind?: CalendarItemKind;
};

export type CalendarItem = {
  id: string;
  sourceId: string;
  kind: CalendarItemKind;
  eventType: CalendarEventType | string;
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  notes: string | null;
  location: string | null;
  colorKey: CalendarColorKey | string;
  contactName: string | null;
  contactId: string | null;
  address: string | null;
  displayName?: string | null;
  row?: CalendarEventRow;
};

export type CalendarDayCell = {
  id: string;
  date: Date;
  isInDisplayedMonth: boolean;
};

export type CalendarTimedEventLayout = {
  id: string;
  item: CalendarItem;
  column: number;
  columnCount: number;
  startMinute: number;
  durationMinutes: number;
};

export type CalendarContactOption = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  tags?: string[];
};
