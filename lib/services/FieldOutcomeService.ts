import type { SupabaseClient } from '@supabase/supabase-js';

/** Same visit definition as outcome_counts_as_visit and iOS countsAsSessionDoor. */
export function outcomeCountsAsVisit(status: string | null | undefined): boolean {
  return ['no_answer', 'delivered', 'talked', 'appointment', 'future_seller', 'hot_lead'].includes(status ?? '');
}

export type FieldOutcomeInput = {
  campaignId: string;
  addressIds: string[];
  status: string;
  notes?: string | null;
  occurredAt?: string;
  mutationId?: string;
  baseRevisions?: Record<string, number>;
  farmId?: string | null;
  farmTouchId?: string | null;
  sessionId?: string | null;
  sessionTargetId?: string | null;
  sessionEventType?: string | null;
  latitude?: number;
  longitude?: number;
  overrideReason?: string | null;
};

/** One transaction; never fall back to independent campaign/farm writes. */
export async function recordFieldOutcome(client: SupabaseClient, input: FieldOutcomeInput) {
  const ids = [...new Set(input.addressIds.map(id => id.toLowerCase()))].sort();
  if (!ids.length) throw new Error('Select a home before saving an outcome.');
  if (Boolean(input.farmId) !== Boolean(input.farmTouchId)) {
    throw new Error('Select a farm session before saving this outcome.');
  }
  let revisions = input.baseRevisions;
  if (!revisions) {
    revisions = Object.fromEntries(ids.map(id => [id, 0]));
    for (let offset = 0; offset < ids.length; offset += 250) {
      const { data, error } = await client.from('address_statuses')
        .select('campaign_address_id,revision').eq('campaign_id', input.campaignId)
        .in('campaign_address_id', ids.slice(offset, offset + 250));
      if (error) throw error;
      for (const row of data ?? []) revisions[row.campaign_address_id] = row.revision ?? 0;
    }
  }
  const params = {
    p_campaign_id: input.campaignId, p_campaign_address_ids: ids, p_status: input.status,
    p_notes: input.notes?.trim() || null, p_occurred_at: input.occurredAt ?? new Date().toISOString(),
    p_client_mutation_id: input.mutationId ?? crypto.randomUUID(), p_base_revisions: revisions,
    p_origin_platform: 'web', p_farm_id: input.farmId ?? null, p_farm_touch_id: input.farmTouchId ?? null,
    p_session_id: input.sessionId ?? null, p_session_target_id: input.sessionTargetId ?? null,
    p_session_event_type: input.sessionEventType ?? null, p_lat: input.latitude ?? null,
    p_lon: input.longitude ?? null, p_override_reason: input.overrideReason ?? null,
  };
  const { data, error } = await client.rpc('v3_record_field_outcome', params);
  if (error) throw new Error(error.message);
  if (data?.applied !== true) {
    const code = data?.error_code ?? 'OUTCOME_NOT_SAVED';
    throw new Error(`${code}: The outcome was not saved. Refresh the home before trying again.`);
  }
  return data;
}
