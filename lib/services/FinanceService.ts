import { createClient } from '@/lib/supabase/client';
import type { FinanceEntry, FinanceEntryCategory } from '@/types/database';

function formatError(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const candidate = error as { message?: string; details?: string | null; hint?: string | null };
  return [candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' | ') || 'Unknown error';
}

export interface CreateFinanceEntryPayload {
  workspace_id?: string | null;
  campaign_id?: string | null;
  farm_id?: string | null;
  agent_user_id?: string | null;
  category: FinanceEntryCategory;
  description: string;
  vendor?: string | null;
  postal_code?: string | null;
  quantity?: number;
  unit_label?: string | null;
  unit_cost_cents?: number;
  total_cost_cents: number;
  currency?: 'CAD';
  incurred_on?: string;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export class FinanceService {
  private static client = createClient();

  static async fetchEntriesForTarget(options: {
    campaignId?: string | null;
    farmId?: string | null;
  }): Promise<FinanceEntry[]> {
    const { campaignId, farmId } = options;
    let query = this.client
      .from('finance_entries')
      .select('*')
      .order('incurred_on', { ascending: false })
      .order('created_at', { ascending: false });

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    } else if (farmId) {
      query = query.eq('farm_id', farmId);
    } else {
      return [];
    }

    const { data, error } = await query;
    if (error) throw new Error(formatError(error));
    return (data || []) as FinanceEntry[];
  }

  static async createEntry(createdBy: string, payload: CreateFinanceEntryPayload): Promise<FinanceEntry> {
    if (!payload.campaign_id && !payload.farm_id) {
      throw new Error('A campaign or farm must be selected for this finance entry');
    }

    const { data, error } = await this.client
      .from('finance_entries')
      .insert({
        workspace_id: payload.workspace_id ?? null,
        created_by: createdBy,
        campaign_id: payload.campaign_id ?? null,
        farm_id: payload.farm_id ?? null,
        agent_user_id: payload.agent_user_id ?? createdBy,
        category: payload.category,
        description: payload.description.trim(),
        vendor: payload.vendor?.trim() || null,
        postal_code: payload.postal_code?.trim() || null,
        quantity: Math.max(0, Math.trunc(payload.quantity ?? 1)),
        unit_label: payload.unit_label?.trim() || 'item',
        unit_cost_cents: Math.max(0, Math.trunc(payload.unit_cost_cents ?? 0)),
        total_cost_cents: Math.max(0, Math.trunc(payload.total_cost_cents)),
        currency: payload.currency ?? 'CAD',
        incurred_on: payload.incurred_on || new Date().toISOString().slice(0, 10),
        notes: payload.notes?.trim() || null,
        metadata: payload.metadata ?? {},
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(formatError(error));
    return data as FinanceEntry;
  }
}
