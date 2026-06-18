import type { createAdminClient } from '@/lib/supabase/server';
import { normalizePhoneNumber } from '@/lib/dialer/phone';

type AdminClient = ReturnType<typeof createAdminClient>;

export type DialerSalespersonRow = {
  id: string;
  user_id?: string | null;
  full_name: string | null;
  email: string | null;
  status: 'active' | 'paused' | 'inactive';
  referral_code?: string | null;
  workspace_id?: string | null;
  demo_email_handle?: string | null;
  demo_email_reply_to?: string | null;
  stripe_connect_account_id?: string | null;
  stripe_onboarding_completed?: boolean | null;
  stripe_details_submitted?: boolean | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
};

export type SalespersonDialerSettingsRow = {
  id: string;
  salesperson_id: string;
  workspace_id: string;
  assigned_phone_number: string | null;
  default_sms_from_number: string | null;
  inbound_forward_to: string | null;
  twilio_incoming_phone_number_sid: string | null;
  number_status: 'unassigned' | 'active' | 'released';
  number_assigned_at: string | null;
  provisioning_metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const SALESPERSON_SELECT =
  'id, user_id, full_name, email, status, referral_code, workspace_id, demo_email_handle, demo_email_reply_to, stripe_connect_account_id, stripe_onboarding_completed, stripe_details_submitted, stripe_charges_enabled, stripe_payouts_enabled';

function cleanEmail(value: string | null | undefined): string | null {
  const cleaned = value?.trim().toLowerCase();
  return cleaned || null;
}

function isMissingUserIdColumn(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '').toLowerCase()
      : '';
  return message.includes('user_id') && message.includes('salespeople');
}

function serializeSalesperson(data: unknown): DialerSalespersonRow | null {
  return (data as DialerSalespersonRow | null) ?? null;
}

export async function resolveSalespersonForUser(
  admin: AdminClient,
  params: {
    userId: string;
    email?: string | null;
    workspaceId?: string | null;
  }
): Promise<DialerSalespersonRow | null> {
  const byUser = await admin
    .from('salespeople')
    .select(SALESPERSON_SELECT)
    .eq('user_id', params.userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUser.error && !isMissingUserIdColumn(byUser.error)) {
    console.warn('[dialer/salesperson-settings] user lookup failed', byUser.error);
  }

  if (!byUser.error && byUser.data) {
    return serializeSalesperson(byUser.data);
  }

  const normalizedEmail = cleanEmail(params.email);
  if (!normalizedEmail) return null;

  const select = byUser.error && isMissingUserIdColumn(byUser.error)
    ? SALESPERSON_SELECT.replace('user_id, ', '')
    : SALESPERSON_SELECT;

  const byEmail = await admin
    .from('salespeople')
    .select(select)
    .eq('email', normalizedEmail)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byEmail.error) {
    console.warn('[dialer/salesperson-settings] email lookup failed', byEmail.error);
    return null;
  }

  const salesperson = serializeSalesperson(byEmail.data);
  if (!salesperson) return null;
  if (params.workspaceId && salesperson.workspace_id && salesperson.workspace_id !== params.workspaceId) {
    return null;
  }

  return salesperson;
}

export async function getSalespersonDialerSettings(
  admin: AdminClient,
  salespersonId: string | null | undefined
): Promise<SalespersonDialerSettingsRow | null> {
  if (!salespersonId) return null;

  const { data, error } = await admin
    .from('salesperson_dialer_settings')
    .select('*')
    .eq('salesperson_id', salespersonId)
    .maybeSingle();

  if (error) {
    console.warn('[dialer/salesperson-settings] settings lookup failed', error);
    return null;
  }

  return (data as SalespersonDialerSettingsRow | null) ?? null;
}

export async function getSalespersonDialerSettingsForUser(
  admin: AdminClient,
  params: {
    userId: string;
    email?: string | null;
    workspaceId?: string | null;
  }
): Promise<{
  salesperson: DialerSalespersonRow | null;
  settings: SalespersonDialerSettingsRow | null;
}> {
  const salesperson = await resolveSalespersonForUser(admin, params);
  const settings = await getSalespersonDialerSettings(admin, salesperson?.id);
  return { salesperson, settings };
}

export function normalizeSalespersonDialerNumber(value: string | null | undefined): string | null {
  return normalizePhoneNumber(value).e164 || null;
}
