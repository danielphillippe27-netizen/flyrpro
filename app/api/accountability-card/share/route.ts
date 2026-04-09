import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await auth.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const raw = await request.json().catch(() => ({}));
    const postId = raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).post_id === 'string'
      ? String((raw as Record<string, unknown>).post_id)
      : null;

    if (!postId) {
      return NextResponse.json({ error: 'post_id is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('accountability_posts')
      .update({ shared_at: new Date().toISOString() })
      .eq('id', postId)
      .eq('user_id', user.id)
      .is('shared_at', null);

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark accountability post shared';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
