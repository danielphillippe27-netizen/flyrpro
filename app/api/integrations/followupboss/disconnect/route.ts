import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    // Get current user
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Delete the connection
    const { error } = await supabase
      .from('crm_connections')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'followupboss');

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully disconnected from Follow Up Boss',
    });
  } catch (error) {
    console.error('Error disconnecting from FUB:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to disconnect' },
      { status: 500 }
    );
  }
}
