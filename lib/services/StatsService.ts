import { createClient } from '@/lib/supabase/client';
import type { UserStats } from '@/types/database';

export type StatsPeriod = 'daily' | 'weekly' | 'monthly' | 'lifetime';

type AppointmentCandidateRow = {
  full_name?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  campaign_id?: string | null;
  status?: string | null;
  appointment_at?: string | null;
};

type LeadCandidateRow = AppointmentCandidateRow;

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '';
}

function isMissingContactsColumn(error: unknown, column: string): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes(`column contacts.${column}`) ||
    message.includes(`column "${column}"`) ||
    message.includes(`'${column}' column`) ||
    message.includes(`${column} does not exist`)
  );
}

function mapRow(row: Record<string, unknown>): UserStats {
  return {
    id: String(row.id ?? ''),
    user_id: String(row.user_id ?? ''),
    day_streak: typeof row.day_streak === 'number' ? row.day_streak : 0,
    best_streak: typeof row.best_streak === 'number' ? row.best_streak : 0,
    doors_knocked: typeof row.doors_knocked === 'number' ? row.doors_knocked : 0,
    flyers: typeof row.flyers === 'number' ? row.flyers : 0,
    conversations: typeof row.conversations === 'number' ? row.conversations : 0,
    leads_created: typeof row.leads_created === 'number' ? row.leads_created : 0,
    qr_codes_scanned: typeof row.qr_codes_scanned === 'number' ? row.qr_codes_scanned : 0,
    distance_walked: typeof row.distance_walked === 'number' ? row.distance_walked : 0,
    time_tracked: typeof row.time_tracked === 'number' ? row.time_tracked : 0,
    conversation_per_door: typeof row.conversation_per_door === 'number' ? row.conversation_per_door : 0,
    conversation_lead_rate: typeof row.conversation_lead_rate === 'number' ? row.conversation_lead_rate : 0,
    qr_code_scan_rate: typeof row.qr_code_scan_rate === 'number' ? row.qr_code_scan_rate : 0,
    qr_code_lead_rate: typeof row.qr_code_lead_rate === 'number' ? row.qr_code_lead_rate : 0,
    streak_days: Array.isArray(row.streak_days) ? (row.streak_days as string[]) : null,
    xp: typeof row.xp === 'number' ? row.xp : 0,
    routes_walked: typeof row.routes_walked === 'number' ? row.routes_walked : 0,
    updated_at: String(row.updated_at ?? ''),
    created_at: row.created_at != null ? String(row.created_at) : null,
  };
}

function isAppointmentStatus(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return normalized === 'interested' || normalized === 'hot' || normalized === 'appointment';
}

function hasAppointment(row: AppointmentCandidateRow): boolean {
  return Boolean(row.appointment_at) || isAppointmentStatus(row.status);
}

function appointmentSignature(row: AppointmentCandidateRow): string {
  return [
    (row.full_name ?? row.name ?? '').trim().toLowerCase(),
    (row.phone ?? '').trim(),
    (row.email ?? '').trim().toLowerCase(),
    (row.address ?? '').trim().toLowerCase(),
    (row.campaign_id ?? '').trim(),
  ].join('|');
}

async function fetchLeadCandidateRows(
  client: ReturnType<typeof createClient>,
  userId: string
): Promise<LeadCandidateRow[]> {
  const [{ data: initialContacts, error: initialContactsError }, legacyResult] = await Promise.all([
    client
      .from('contacts')
      .select('full_name, phone, email, address, campaign_id, status, appointment_at')
      .eq('user_id', userId),
    client
      .from('field_leads')
      .select('full_name, name, phone, email, address, campaign_id, status')
      .eq('user_id', userId),
  ]);

  let contacts = initialContacts;
  let contactsError = initialContactsError;

  if (contactsError && isMissingContactsColumn(contactsError, 'appointment_at')) {
    const retryResult = await client
      .from('contacts')
      .select('full_name, phone, email, address, campaign_id, status')
      .eq('user_id', userId);

    contacts = retryResult.data;
    contactsError = retryResult.error;
  }

  if (contactsError) {
    throw new Error(contactsError.message || 'Failed to load leads');
  }

  return [
    ...((contacts ?? []) as LeadCandidateRow[]),
    ...(legacyResult.error ? [] : ((legacyResult.data ?? []) as LeadCandidateRow[])),
  ];
}

export class StatsService {
  private static client = createClient();

  private static emptyStats(userId = ''): UserStats {
    const nowIso = new Date().toISOString();
    return {
      id: userId,
      user_id: userId,
      day_streak: 0,
      best_streak: 0,
      doors_knocked: 0,
      flyers: 0,
      conversations: 0,
      leads_created: 0,
      qr_codes_scanned: 0,
      distance_walked: 0,
      time_tracked: 0,
      conversation_per_door: 0,
      conversation_lead_rate: 0,
      qr_code_scan_rate: 0,
      qr_code_lead_rate: 0,
      streak_days: null,
      xp: 0,
      routes_walked: 0,
      updated_at: nowIso,
      created_at: nowIso,
    };
  }

  /**
   * Fetches the current user's stats from public.user_stats.
   * Same table iOS updates via increment_user_stats RPC and the sessions trigger.
   * Read path: direct table read (no RPC).
   */
  static async fetchUserStats(userId: string): Promise<UserStats | null> {
    const { data, error } = await this.client
      .from('user_stats')
      .select('*')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message || 'Failed to load stats');
    if (!data) return null;
    return mapRow(data as Record<string, unknown>);
  }

  static async fetchUserStatsForUsers(userIds: string[]): Promise<UserStats[]> {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) return [];

    const { data, error } = await this.client
      .from('user_stats')
      .select('*')
      .in('user_id', uniqueUserIds);

    if (error) throw new Error(error.message || 'Failed to load stats');
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => mapRow(row));
  }

  static aggregateUserStats(stats: UserStats[], userId = 'all'): UserStats | null {
    if (stats.length === 0) return null;

    const aggregated = this.emptyStats(userId);
    let latestUpdatedAt = aggregated.updated_at;

    for (const stat of stats) {
      aggregated.day_streak = Math.max(aggregated.day_streak, stat.day_streak);
      aggregated.best_streak = Math.max(aggregated.best_streak, stat.best_streak);
      aggregated.doors_knocked += stat.doors_knocked;
      aggregated.flyers += stat.flyers;
      aggregated.conversations += stat.conversations;
      aggregated.leads_created += stat.leads_created;
      aggregated.qr_codes_scanned += stat.qr_codes_scanned;
      aggregated.distance_walked += stat.distance_walked;
      aggregated.time_tracked += stat.time_tracked;
      aggregated.xp += stat.xp;
      aggregated.routes_walked = (aggregated.routes_walked ?? 0) + (stat.routes_walked ?? 0);

      if (stat.updated_at > latestUpdatedAt) {
        latestUpdatedAt = stat.updated_at;
      }
    }

    aggregated.updated_at = latestUpdatedAt;
    aggregated.conversation_per_door =
      aggregated.doors_knocked > 0 ? aggregated.conversations / aggregated.doors_knocked : 0;
    aggregated.conversation_lead_rate =
      aggregated.conversations > 0 ? aggregated.leads_created / aggregated.conversations : 0;
    aggregated.qr_code_scan_rate =
      aggregated.flyers > 0 ? aggregated.qr_codes_scanned / aggregated.flyers : 0;
    aggregated.qr_code_lead_rate =
      aggregated.qr_codes_scanned > 0 ? aggregated.leads_created / aggregated.qr_codes_scanned : 0;

    return aggregated;
  }

  static async fetchAppointmentCount(userId: string): Promise<number> {
    const rows = await fetchLeadCandidateRows(this.client, userId);

    const signatures = new Set<string>();
    let count = 0;

    for (const row of rows) {
      if (!hasAppointment(row)) continue;
      const signature = appointmentSignature(row);
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      count += 1;
    }

    return count;
  }

  static async fetchLeadCount(userId: string): Promise<number> {
    const rows = await fetchLeadCandidateRows(this.client, userId);
    const signatures = new Set<string>();

    for (const row of rows) {
      signatures.add(appointmentSignature(row));
    }

    return signatures.size;
  }

  static async createOrUpdateUserStats(userId: string, updates: Partial<UserStats>): Promise<UserStats> {
    // Check if stats exist
    const existing = await this.fetchUserStats(userId);

    if (existing) {
      const { data, error } = await this.client
        .from('user_stats')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return mapRow((data ?? {}) as Record<string, unknown>);
    } else {
      const { data, error } = await this.client
        .from('user_stats')
        .insert({
          user_id: userId,
          day_streak: 0,
          best_streak: 0,
          doors_knocked: 0,
          flyers: 0,
          conversations: 0,
          leads_created: 0,
          qr_codes_scanned: 0,
          distance_walked: 0,
          time_tracked: 0,
          conversation_per_door: 0,
          conversation_lead_rate: 0,
          qr_code_scan_rate: 0,
          qr_code_lead_rate: 0,
          streak_days: null,
          xp: 0,
          ...updates,
        })
        .select()
        .single();

      if (error) throw error;
      return mapRow((data ?? {}) as Record<string, unknown>);
    }
  }
}
