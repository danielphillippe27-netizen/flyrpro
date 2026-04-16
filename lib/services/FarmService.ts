import { createClient } from '@/lib/supabase/client';
import { getNextFarmCycleNumber } from '@/lib/farms/analytics';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import type {
  Farm,
  FarmTouch,
  FarmLead,
  FarmAddress,
  FarmSessionMode,
  FarmTouchAddress,
  FarmAddressOutcomeStatus,
} from '@/types/database';
import type { CreateFarmPayload } from '@/types/farms';

type LegacyFarmTouchRow = Partial<FarmTouch> & {
  date?: string | null;
  type?: string | null;
  completed?: boolean | null;
  completed_at?: string | null;
};

function formatError(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const candidate = error as { message?: string; details?: string | null; hint?: string | null };
  return [candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' | ') || 'Unknown error';
}

function isMissingColumnError(error: unknown, column: string): boolean {
  const message = formatError(error).toLowerCase();
  return (
    message.includes(`could not find the '${column}' column`) ||
    message.includes(`column farms.${column}`) ||
    message.includes(`column farm_touches.${column}`) ||
    message.includes(`column farm_addresses.${column}`) ||
      message.includes(`column farm_touch_addresses.${column}`) ||
    message.includes(`${column} does not exist`)
  );
}

function withFarmProgress<T extends Farm>(farm: T): T {
  const startDate = new Date(farm.start_date);
  const endDate = new Date(farm.end_date);
  const now = new Date();
  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  const progress = totalDuration > 0 ? Math.min(Math.max(elapsed / totalDuration, 0), 1) : 0;

  return {
    ...farm,
    progress,
    is_active: farm.is_active ?? true,
    touches_per_interval: farm.touches_per_interval ?? farm.frequency ?? 2,
    touches_interval: farm.touches_interval ?? 'month',
    goal_type: farm.goal_type ?? (farm.touches_interval === 'year' ? 'touches_per_year' : 'touches_per_cycle'),
    goal_target: farm.goal_target ?? farm.touches_per_interval ?? farm.frequency ?? 2,
    cycle_completion_window_days: farm.cycle_completion_window_days ?? null,
    touch_types: farm.touch_types ?? [],
    home_limit: farm.home_limit ?? 5000,
    address_count: farm.address_count ?? 0,
  };
}

function normalizeFarmTouchModeValue(
  value: FarmTouch['mode'] | 'canvassing' | 'flyer_drop' | 'mail' | 'event' | 'door_knock' | 'letters' | string | null | undefined
): FarmTouch['mode'] {
  if (value === 'canvassing') return 'doorknock';
  if (value === 'door_knock') return 'doorknock';
  if (value === 'flyer_drop') return 'flyer';
  if (value === 'mail') return 'letter';
  if (value === 'letters') return 'letter';
  if (value === 'event') return 'pop_by';
  return value as FarmTouch['mode'];
}

function resolveFarmTouchMode(touch: LegacyFarmTouchRow): FarmTouch['mode'] {
  if (touch.mode && touch.mode !== 'canvassing') {
    return normalizeFarmTouchModeValue(touch.mode);
  }
  if (touch.type) {
    return normalizeFarmTouchModeValue(touch.type);
  }
  return normalizeFarmTouchModeValue(touch.mode);
}

function formatLegacyTouchDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getDefaultFarmTouchTitle(mode: FarmSessionMode): string {
  switch (mode) {
    case 'flyer':
      return 'Flyer session';
    case 'canada_post':
      return 'Canada Post session';
    case 'pop_by':
      return 'Pop by session';
    case 'letter':
      return 'Letter session';
    case 'doorknock':
    default:
      return 'Doorknock session';
  }
}

function getLegacyFarmTouchType(mode: FarmSessionMode): 'door_knock' | 'flyer' | 'event' {
  switch (mode) {
    case 'doorknock':
      return 'door_knock';
    case 'pop_by':
      return 'event';
    case 'flyer':
    case 'canada_post':
    case 'letter':
    default:
      return 'flyer';
  }
}

function normalizeFarmTouchStatus(
  touch: LegacyFarmTouchRow
): FarmTouch['status'] {
  if (touch.status === 'scheduled' || touch.status === 'in_progress' || touch.status === 'completed' || touch.status === 'skipped') {
    return touch.status;
  }
  if (touch.completed || touch.completed_at || touch.completed_date || touch.last_completed_at) return 'completed';
  if (touch.started_at) return 'in_progress';
  return 'scheduled';
}

function withFarmTouchDefaults<T extends LegacyFarmTouchRow>(touch: T): T & Pick<FarmTouch, 'mode' | 'status' | 'scheduled_date' | 'completed_date' | 'last_completed_at'> {
  return {
    ...touch,
    mode: resolveFarmTouchMode(touch),
    scheduled_date: touch.scheduled_date ?? touch.date ?? touch.created_at ?? new Date().toISOString(),
    completed_date: touch.completed_date ?? touch.completed_at ?? undefined,
    last_completed_at: touch.last_completed_at ?? touch.completed_at ?? touch.completed_date ?? undefined,
    status: normalizeFarmTouchStatus(touch),
  };
}

const FARM_ADDRESS_OUTCOME_STATUSES: FarmAddressOutcomeStatus[] = [
  'none',
  'no_answer',
  'delivered',
  'talked',
  'appointment',
  'do_not_knock',
  'future_seller',
  'hot_lead',
];

export class FarmService {
  private static client = createClient();

  static async fetchFarms(userId: string, workspaceId?: string | null): Promise<Farm[]> {
    let query = this.client.from('farms').select('*').order('created_at', { ascending: false });
    if (workspaceId) {
      query = query.or(`workspace_id.eq.${workspaceId},and(owner_id.eq.${userId},workspace_id.is.null)`);
    } else {
      query = query.eq('owner_id', userId);
    }

    let { data, error } = await query;
    if (error && workspaceId && isMissingColumnError(error, 'workspace_id')) {
      const fallback = await this.client
        .from('farms')
        .select('*')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false });
      data = fallback.data;
      error = fallback.error;
    }

    if (error) throw new Error(formatError(error));
    return ((data || []) as Farm[]).map(withFarmProgress);
  }

  static async fetchFarm(id: string): Promise<Farm | null> {
    const { data, error } = await this.client.from('farms').select('*').eq('id', id).single();
    if (error && error.code !== 'PGRST116') throw new Error(formatError(error));
    if (!data) return null;
    return withFarmProgress(data as Farm);
  }

  static async createFarm(userId: string, payload: CreateFarmPayload): Promise<Farm> {
    const basePayload = {
      owner_id: userId,
      workspace_id: payload.workspace_id ?? undefined,
      name: payload.name,
      description: payload.description ?? null,
      polygon: payload.polygon,
      start_date: payload.start_date,
      end_date: payload.end_date,
      frequency: payload.frequency,
      is_active: true,
      touches_per_interval: payload.touches_per_interval ?? payload.frequency,
      touches_interval: payload.touches_interval ?? 'month',
      goal_type: payload.goal_type ?? (payload.touches_interval === 'year' ? 'touches_per_year' : 'touches_per_cycle'),
      goal_target: payload.goal_target ?? payload.touches_per_interval ?? payload.frequency,
      cycle_completion_window_days: payload.cycle_completion_window_days ?? null,
      touch_types: payload.touch_types ?? [],
      annual_budget_cents: payload.annual_budget_cents ?? null,
      area_label: payload.area_label ?? null,
      home_limit: payload.home_limit ?? 5000,
      address_count: payload.address_count ?? 0,
    };

    const fallbackPayload: Record<string, unknown> = { ...basePayload };
    const removableColumns = [
      'workspace_id',
      'description',
      'is_active',
      'touches_per_interval',
      'touches_interval',
      'goal_type',
      'goal_target',
      'cycle_completion_window_days',
      'touch_types',
      'annual_budget_cents',
      'home_limit',
      'address_count',
    ] as const;

    let { data, error } = await this.client.from('farms').insert(fallbackPayload).select().single();

    while (error) {
      const missingColumn = removableColumns.find(
        (column) => column in fallbackPayload && isMissingColumnError(error, column)
      );
      if (!missingColumn) break;
      delete fallbackPayload[missingColumn];
      const retry = await this.client.from('farms').insert(fallbackPayload).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw new Error(formatError(error));
    return withFarmProgress(data as Farm);
  }

  static async updatePolygon(farmId: string, polygon: string): Promise<void> {
    const { error } = await this.client
      .from('farms')
      .update({ polygon, updated_at: new Date().toISOString() })
      .eq('id', farmId);

    if (error && isMissingColumnError(error, 'updated_at')) {
      const retry = await this.client.from('farms').update({ polygon }).eq('id', farmId);
      if (retry.error) throw new Error(formatError(retry.error));
      return;
    }

    if (error) throw new Error(formatError(error));
  }

  static async updateFarm(id: string, updates: Partial<Farm>): Promise<void> {
    const fallbackUpdates: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    };
    const removableColumns = [
      'updated_at',
      'is_active',
      'touches_per_interval',
      'touches_interval',
      'goal_type',
      'goal_target',
      'cycle_completion_window_days',
      'touch_types',
      'annual_budget_cents',
    ] as const;

    let { error } = await this.client.from('farms').update(fallbackUpdates).eq('id', id);

    while (error) {
      const missingColumn = removableColumns.find(
        (column) => column in fallbackUpdates && isMissingColumnError(error, column)
      );
      if (!missingColumn) break;
      delete fallbackUpdates[missingColumn];
      const retry = await this.client.from('farms').update(fallbackUpdates).eq('id', id);
      error = retry.error;
    }

    if (error) throw new Error(formatError(error));
  }

  static async fetchAddresses(farmId: string): Promise<FarmAddress[]> {
    try {
      const rows = await fetchAllInPages((from, to) =>
        this.client
          .from('farm_addresses')
          .select('*')
          .eq('farm_id', farmId)
          .order('street_name', { ascending: true, nullsFirst: false })
          .order('house_number', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to)
      );

      return ((rows || []) as Array<FarmAddress & { latitude?: number | null; longitude?: number | null }>).map((row) => ({
        ...row,
        coordinate:
          row.coordinate ??
          (typeof row.latitude === 'number' && typeof row.longitude === 'number'
            ? { lat: row.latitude, lon: row.longitude }
            : null),
      }));
    } catch (error) {
      console.warn('fetch farm addresses:', formatError(error));
      return [];
    }
  }

  static async deleteFarm(id: string): Promise<void> {
    const { error } = await this.client.from('farms').delete().eq('id', id);
    if (error) throw new Error(formatError(error));
  }
}

export class FarmTouchService {
  private static client = createClient();

  static async createSession(payload: {
    farmId: string;
    workspaceId?: string | null;
    cycleNumber?: number | null;
    mode: FarmSessionMode;
    title?: string;
    scheduledDate?: string;
    notes?: string;
    homesTarget?: number | null;
  }): Promise<FarmTouch> {
    const [existingTouches, farm] = await Promise.all([
      this.fetchTouches(payload.farmId).catch(() => []),
      FarmService.fetchFarm(payload.farmId).catch(() => null),
    ]);
    const resolvedCycleNumber =
      payload.cycleNumber ??
      getNextFarmCycleNumber(existingTouches, farm?.touches_per_interval ?? farm?.frequency ?? 1);
    const scheduledDate = payload.scheduledDate ?? new Date().toISOString();
    const legacyDate = formatLegacyTouchDate(scheduledDate);
    const resolvedTitle = payload.title?.trim() || getDefaultFarmTouchTitle(payload.mode);
    const legacyType = getLegacyFarmTouchType(payload.mode);

    const basePayload = {
      farm_id: payload.farmId,
      workspace_id: payload.workspaceId ?? undefined,
      cycle_number: resolvedCycleNumber,
      mode: payload.mode,
      type: legacyType,
      title: resolvedTitle,
      scheduled_date: scheduledDate,
      date: legacyDate,
      completed: false,
      notes: payload.notes ?? null,
      homes_target: payload.homesTarget ?? null,
    };

    const fallbackPayload: Record<string, unknown> = { ...basePayload };
    const removableColumns = [
      'workspace_id',
      'cycle_number',
      'mode',
      'type',
      'title',
      'scheduled_date',
      'date',
      'completed',
      'homes_target',
    ] as const;

    let { data, error } = await this.client.from('farm_touches').insert(fallbackPayload).select().single();

    while (error) {
      const missingColumn = removableColumns.find(
        (column) => column in fallbackPayload && isMissingColumnError(error, column)
      );
      if (!missingColumn) break;
      delete fallbackPayload[missingColumn];
      const retry = await this.client.from('farm_touches').insert(fallbackPayload).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw new Error(formatError(error));
    return withFarmTouchDefaults(data as FarmTouch);
  }

  static async scheduleTouch(payload: {
    farmId: string;
    scheduledDate: string;
    notes?: string;
  }): Promise<FarmTouch> {
    return this.createSession({
      farmId: payload.farmId,
      mode: 'doorknock',
      scheduledDate: payload.scheduledDate,
      notes: payload.notes,
    });
  }

  static async fetchTouches(farmId: string): Promise<FarmTouch[]> {
    let { data, error } = await this.client
      .from('farm_touches')
      .select('*')
      .eq('farm_id', farmId)
      .order('scheduled_date', { ascending: false });

    if (error && isMissingColumnError(error, 'scheduled_date')) {
      const fallback = await this.client
        .from('farm_touches')
        .select('*')
        .eq('farm_id', farmId)
        .order('date', { ascending: false, nullsFirst: false });
      data = fallback.data;
      error = fallback.error;
    }

    if (error && isMissingColumnError(error, 'date')) {
      const fallback = await this.client
        .from('farm_touches')
        .select('*')
        .eq('farm_id', farmId)
        .order('created_at', { ascending: false });
      data = fallback.data;
      error = fallback.error;
    }

    if (error) throw new Error(formatError(error));
    return ((data || []) as LegacyFarmTouchRow[]).map((touch) => withFarmTouchDefaults(touch) as FarmTouch);
  }

  static async updateTouch(touchId: string, updates: Partial<FarmTouch>): Promise<void> {
    const nextUpdates: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    let { error } = await this.client.from('farm_touches').update(nextUpdates).eq('id', touchId);

    while (error) {
      const missingColumn = Object.keys(nextUpdates).find(
        (column) => column in nextUpdates && isMissingColumnError(error, column)
      );
      if (!missingColumn) break;
      delete nextUpdates[missingColumn];
      if (Object.keys(nextUpdates).length === 0) return;
      const retry = await this.client.from('farm_touches').update(nextUpdates).eq('id', touchId);
      error = retry.error;
    }

    if (error) throw new Error(formatError(error));
  }

  static async startTouch(touchId: string): Promise<void> {
    const startedAt = new Date().toISOString();
    try {
      await this.updateTouch(touchId, {
        status: 'in_progress',
        started_at: startedAt,
      });
    } catch (error) {
      if (!isMissingColumnError(error, 'started_at')) throw new Error(formatError(error));
      await this.updateTouch(touchId, { status: 'in_progress' });
    }
  }

  static async completeTouch(
    touchId: string,
    options?: {
      notes?: string;
      homesReached?: number | null;
    }
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    const updates: Partial<FarmTouch> & { completed?: boolean; completed_at?: string } = {
      status: 'completed',
      completed_date: completedAt,
      last_completed_at: completedAt,
      completed: true,
      completed_at: completedAt,
      notes: options?.notes,
      homes_reached: options?.homesReached ?? null,
    };

    try {
      await this.updateTouch(touchId, updates);
    } catch (error) {
      if (
        !isMissingColumnError(error, 'homes_reached') &&
        !isMissingColumnError(error, 'last_completed_at')
      ) {
        throw new Error(formatError(error));
      }
      await this.updateTouch(touchId, {
        status: 'completed',
        completed_date: completedAt,
        completed: true,
        completed_at: completedAt,
        notes: options?.notes,
      });
    }
  }
}

export class FarmLeadService {
  private static client = createClient();

  static async createLead(payload: {
    farmId: string;
    touchId?: string;
    leadSource: string;
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
  }): Promise<FarmLead> {
    const { data, error } = await this.client
      .from('farm_leads')
      .insert({
        farm_id: payload.farmId,
        touch_id: payload.touchId,
        lead_source: payload.leadSource,
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
      })
      .select()
      .single();

    if (error) throw new Error(formatError(error));
    return data as FarmLead;
  }

  static async fetchLeads(farmId: string): Promise<FarmLead[]> {
    const { data, error } = await this.client
      .from('farm_leads')
      .select('*')
      .eq('farm_id', farmId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(formatError(error));
    return (data || []) as FarmLead[];
  }
}

export class FarmTouchOutcomeService {
  private static client = createClient();

  static async fetchOutcomes(farmId: string): Promise<FarmTouchAddress[]> {
    const { data, error } = await this.client
      .from('farm_touch_addresses')
      .select('*')
      .eq('farm_id', farmId)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      if (isMissingColumnError(error, 'campaign_address_id')) {
        const fallback = await this.client
          .from('farm_touch_addresses')
          .select('id, farm_id, farm_touch_id, farm_address_id, status, notes, occurred_at, created_by, created_at, updated_at')
          .eq('farm_id', farmId)
          .order('occurred_at', { ascending: false })
          .order('created_at', { ascending: false });
        if (fallback.error) throw new Error(formatError(fallback.error));
        return (fallback.data || []) as FarmTouchAddress[];
      }
      throw new Error(formatError(error));
    }

    return (data || []) as FarmTouchAddress[];
  }

  static async recordOutcome(payload: {
    farmId: string;
    farmTouchId: string;
    farmAddressId?: string | null;
    campaignAddressId?: string | null;
    status: FarmAddressOutcomeStatus;
    notes?: string | null;
    occurredAt?: string;
  }): Promise<unknown> {
    if (!FARM_ADDRESS_OUTCOME_STATUSES.includes(payload.status)) {
      throw new Error(`Unsupported farm address outcome: ${payload.status}`);
    }

    const { data, error } = await this.client.rpc('record_farm_address_outcome', {
      p_farm_id: payload.farmId,
      p_farm_touch_id: payload.farmTouchId,
      p_farm_address_id: payload.farmAddressId ?? null,
      p_campaign_address_id: payload.campaignAddressId ?? null,
      p_status: payload.status,
      p_notes: payload.notes?.trim() || null,
      p_occurred_at: payload.occurredAt ?? new Date().toISOString(),
    });

    if (error) throw new Error(formatError(error));
    return data;
  }
}
