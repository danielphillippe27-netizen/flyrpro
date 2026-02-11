import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';

export type WeeklyGoalsPayload = {
  weekly_door_goal?: number;
  weekly_sessions_goal?: number | null;
  weekly_minutes_goal?: number | null;
};

/**
 * GET: Return current user's weekly goals (used by settings or Edit goals modal).
 */
export async function GET() {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('user_profiles')
      .select('weekly_door_goal, weekly_sessions_goal, weekly_minutes_goal')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Goals GET error:', error);
      return NextResponse.json({ error: 'Failed to load goals' }, { status: 500 });
    }

    return NextResponse.json({
      weekly_door_goal: data?.weekly_door_goal ?? 100,
      weekly_sessions_goal: data?.weekly_sessions_goal ?? null,
      weekly_minutes_goal: data?.weekly_minutes_goal ?? null,
    });
  } catch (err) {
    console.error('Goals GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH: Update current user's weekly goals.
 */
export async function PATCH(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as WeeklyGoalsPayload;
    const updates: Record<string, number | null> = {};

    if (body.weekly_door_goal !== undefined) {
      updates.weekly_door_goal = Math.max(0, Number(body.weekly_door_goal));
    }
    if (body.weekly_sessions_goal !== undefined) {
      updates.weekly_sessions_goal = body.weekly_sessions_goal == null ? null : Math.max(0, Number(body.weekly_sessions_goal));
    }
    if (body.weekly_minutes_goal !== undefined) {
      updates.weekly_minutes_goal = body.weekly_minutes_goal == null ? null : Math.max(0, Number(body.weekly_minutes_goal));
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existing) {
      const { data: inserted, error: insertError } = await supabase
        .from('user_profiles')
        .insert({ user_id: user.id, ...updates })
        .select('weekly_door_goal, weekly_sessions_goal, weekly_minutes_goal')
        .single();
      if (insertError) {
        console.error('Goals insert error:', insertError);
        return NextResponse.json({ error: 'Failed to save goals' }, { status: 500 });
      }
      return NextResponse.json(inserted);
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('user_id', user.id)
      .select('weekly_door_goal, weekly_sessions_goal, weekly_minutes_goal')
      .single();

    if (error) {
      console.error('Goals PATCH error:', error);
      return NextResponse.json({ error: 'Failed to update goals' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('Goals PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
