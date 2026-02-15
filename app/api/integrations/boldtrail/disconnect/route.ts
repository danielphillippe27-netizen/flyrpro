import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { error } = await supabase
      .from('crm_connections')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'boldtrail');

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Successfully disconnected from BoldTrail',
    });
  } catch (error) {
    console.error('Error disconnecting from BoldTrail:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to disconnect' },
      { status: 500 }
    );
  }
}
