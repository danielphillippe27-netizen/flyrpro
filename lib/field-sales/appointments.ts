import { createClient } from '@/lib/supabase/client';

export type Appointment = {
  id: string;
  workspace_id: string;
  contact_id: string;
  contact_name: string;
  property_label: string | null;
  appointment_type: string;
  assignee_id: string | null;
  setter_id: string | null;
  setter_name: string | null;
  assignee_name: string | null;
  start_at: string;
  end_at: string;
  status: 'scheduled' | 'confirmed' | 'held' | 'no_show' | 'cancelled' | 'legacy_unknown';
  timezone: string;
  notes: string;
  version: number;
  can_update: boolean;
  can_assign: boolean;
};

export type AppointmentList = {
  enabled: boolean;
  can_write: boolean;
  can_assign: boolean;
  timezone: string | null;
  appointments: Appointment[];
};
export type AppointmentOptions = {
  contacts: { id: string; name: string; address: string | null }[];
  representatives: { id: string; name: string }[];
  actor_id: string;
};
export type AppointmentDetail = Appointment & {
  history: { action: string; occurred_at: string; reason: string | null; status: string; actor_name: string | null; assignee_name: string | null; setter_name: string | null }[];
};

export const appointmentsChanged = 'wolfgrid:appointments-changed';

export async function appointmentRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(name, args);
  if (error) throw error;
  return data as T;
}

export function appointmentError(error: unknown) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : 'The appointment could not be loaded or saved.';
}

export async function listAppointments(workspace: string, filters: Record<string, unknown> = {}) {
  try {
    return await appointmentRpc<AppointmentList>('field_appointment_list', { p_workspace: workspace, ...filters });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'PGRST202') return null;
    throw error;
  }
}

export function localAppointmentInput(date: Date) {
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function appointmentDate(value: string) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.valueOf()) || localAppointmentInput(date) !== value) {
    throw new Error('Choose a valid local date and time.');
  }
  return date.toISOString();
}
