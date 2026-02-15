import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data: connection } = await supabase
      .from('crm_connections')
      .select('status, created_at, updated_at, last_tested_at, last_push_at, last_error')
      .eq('user_id', user.id)
      .eq('provider', 'boldtrail')
      .maybeSingle();

    if (!connection) {
      return NextResponse.json({
        connected: false,
        status: 'disconnected',
      });
    }
    return NextResponse.json({
      connected: connection.status === 'connected',
      status: connection.status,
      createdAt: connection.created_at,
      updatedAt: connection.updated_at,
      lastTestedAt: connection.last_tested_at,
      lastPushAt: connection.last_push_at,
      lastError: connection.last_error,
    });
  } catch (error) {
    console.error('Error getting BoldTrail status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    );
  }
}
