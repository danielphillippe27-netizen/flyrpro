import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { landingPageId } = body;

    if (!landingPageId) {
      return NextResponse.json(
        { error: 'landingPageId is required' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Call RPC function to increment CTA clicks
    const { error } = await supabase.rpc('increment_landing_page_cta_clicks', {
      landing_page_id: landingPageId,
    });

    if (error) {
      console.error('Error incrementing CTA clicks:', error);
      return NextResponse.json(
        { error: 'Failed to track CTA click', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in CTA click tracking:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

