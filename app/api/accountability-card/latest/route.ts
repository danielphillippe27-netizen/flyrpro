import { NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const auth = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await auth.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('accountability_posts')
      .select('id, iso_week, week_start, doors_this_week, conversations_this_week, appointments_this_week, next_week_goal, card_public_url')
      .eq('user_id', user.id)
      .is('shared_at', null)
      .not('card_public_url', 'is', null)
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return NextResponse.json({ post: data ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load accountability card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
