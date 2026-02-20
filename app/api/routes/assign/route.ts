import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

function asUuid(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      routePlanId?: unknown;
      assignedToUserId?: unknown;
    } | null;

    const routePlanId = asUuid(body?.routePlanId);
    const assignedToUserId = asUuid(body?.assignedToUserId);
    if (!routePlanId || !assignedToUserId) {
      return NextResponse.json(
        { error: 'routePlanId and assignedToUserId are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('assign_route_plan', {
      p_route_plan_id: routePlanId,
      p_assigned_to_user_id: assignedToUserId,
    });

    if (error) {
      const message = error.message || 'Failed to assign route plan';
      const forbidden = /forbidden/i.test(message);
      return NextResponse.json({ error: message }, { status: forbidden ? 403 : 500 });
    }

    return NextResponse.json({ assignment: data });
  } catch (error) {
    console.error('[api/routes/assign] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
