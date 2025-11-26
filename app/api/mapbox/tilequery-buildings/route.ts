import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { addresses } = await request.json();

    if (!addresses || !Array.isArray(addresses)) {
      return NextResponse.json({ error: 'Invalid addresses array' }, { status: 400 });
    }

    // Call Supabase Edge Function if available, or implement directly
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Try to call edge function
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/tilequery_buildings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ addresses }),
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data);
      }
    } catch (error) {
      console.error('Edge function call failed:', error);
    }

    // Fallback: Implement basic building polygon fetching
    // This would require Mapbox API integration
    // For now, return success with 0 created/updated
    return NextResponse.json({
      created: 0,
      updated: 0,
      message: 'Edge function not available - implement Mapbox Tilequery API integration',
    });
  } catch (error) {
    console.error('Error in tilequery-buildings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

