import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { buildFarmCampaignDescription } from '@/lib/farms/backingCampaign';
import {
  formatApiError,
  isMissingFarmColumnError,
  resolveBackingCampaignId,
  selectFarmCampaignRow,
  userCanAccessFarm,
} from '@/app/api/farms/_utils/backingCampaign';
import type { FarmTouchInterval, FarmTouchType } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ farmId: string }>;
};

type UpdateFarmBody = {
  name?: string;
  description?: string | null;
  start_date?: string;
  end_date?: string;
  touches_per_interval?: number | null;
  touches_interval?: FarmTouchInterval | null;
  goal_type?: string | null;
  goal_target?: number | null;
  cycle_completion_window_days?: number | null;
  touch_types?: FarmTouchType[] | null;
  annual_budget_cents?: number | null;
  include_social_ads_in_spend?: boolean | null;
};

const FARM_TOUCH_INTERVALS = new Set(['month', 'year']);
const FARM_GOAL_TYPES = new Set(['homes_per_cycle', 'touches_per_cycle', 'touches_per_year']);
const FARM_TOUCH_TYPES = new Set(['doorknock', 'flyer', 'canada_post', 'pop_by', 'letter', 'phone_call', 'social_ad', 'event']);

function cleanNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { farmId } = await context.params;
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { farm, hasLinkedCampaignColumn } = await selectFarmCampaignRow(admin, farmId);
    if (!farm) {
      return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
    }

    const canAccess = await userCanAccessFarm(admin, user.id, farm);
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = (await request.json()) as UpdateFarmBody;
    const trimmedName = body.name?.trim();
    if (!trimmedName) {
      return NextResponse.json({ error: 'Farm name is required' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      name: trimmedName,
      description: body.description?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (body.start_date) updates.start_date = body.start_date;
    if (body.end_date) updates.end_date = body.end_date;

    const touchesPerInterval = cleanNumber(body.touches_per_interval);
    if (touchesPerInterval !== undefined) updates.touches_per_interval = touchesPerInterval;

    if (body.touches_interval === null) {
      updates.touches_interval = null;
    } else if (body.touches_interval && FARM_TOUCH_INTERVALS.has(body.touches_interval)) {
      updates.touches_interval = body.touches_interval;
    }

    if (body.goal_type === null) {
      updates.goal_type = null;
    } else if (body.goal_type && FARM_GOAL_TYPES.has(body.goal_type)) {
      updates.goal_type = body.goal_type;
    }

    const goalTarget = cleanNumber(body.goal_target);
    if (goalTarget !== undefined) updates.goal_target = goalTarget;

    const cycleWindow = cleanNumber(body.cycle_completion_window_days);
    if (cycleWindow !== undefined) updates.cycle_completion_window_days = cycleWindow;

    if (Array.isArray(body.touch_types)) {
      updates.touch_types = body.touch_types.filter((type) => FARM_TOUCH_TYPES.has(type));
    } else if (body.touch_types === null) {
      updates.touch_types = [];
    }

    const annualBudgetCents = cleanNumber(body.annual_budget_cents);
    if (annualBudgetCents !== undefined) updates.annual_budget_cents = annualBudgetCents;
    if (typeof body.include_social_ads_in_spend === 'boolean') {
      updates.include_social_ads_in_spend = body.include_social_ads_in_spend;
    } else if (body.include_social_ads_in_spend === null) {
      updates.include_social_ads_in_spend = false;
    }

    const removableColumns = [
      'updated_at',
      'description',
      'touches_per_interval',
      'touches_interval',
      'goal_type',
      'goal_target',
      'cycle_completion_window_days',
      'touch_types',
      'annual_budget_cents',
      'include_social_ads_in_spend',
    ] as const;

    let updateResult = await admin
      .from('farms')
      .update(updates)
      .eq('id', farmId)
      .select()
      .single();

    while (updateResult.error) {
      const missingColumn = removableColumns.find(
        (column) => column in updates && isMissingFarmColumnError(updateResult.error, column)
      );
      if (!missingColumn) break;
      delete updates[missingColumn];
      updateResult = await admin
        .from('farms')
        .update(updates)
        .eq('id', farmId)
        .select()
        .single();
    }

    if (updateResult.error || !updateResult.data) {
      return NextResponse.json(
        { error: updateResult.error ? formatApiError(updateResult.error) : 'Failed to update farm' },
        { status: 500 }
      );
    }

    const updatedFarm = updateResult.data as typeof farm & { description?: string | null };
    const campaignId = await resolveBackingCampaignId(admin, updatedFarm, hasLinkedCampaignColumn);
    if (campaignId) {
      const { error: campaignError } = await admin
        .from('campaigns')
        .update({
          name: trimmedName,
          title: trimmedName,
          description: buildFarmCampaignDescription(farmId, updatedFarm.description),
        })
        .eq('id', campaignId);

      if (campaignError) {
        return NextResponse.json({ error: formatApiError(campaignError) }, { status: 500 });
      }
    }

    return NextResponse.json(updatedFarm);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown server error' },
      { status: 500 }
    );
  }
}
