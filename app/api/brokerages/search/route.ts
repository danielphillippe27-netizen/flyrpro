import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * GET /api/brokerages/search?q=...&limit=20
 * Typeahead for brokerage names (prefix then contains). Used by onboarding Real Estate section.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') ?? '';
    const limit = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20)
    );

    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.rpc('search_brokerages', {
      query: q,
      max_results: limit,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error('Brokerages search error:', e);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
