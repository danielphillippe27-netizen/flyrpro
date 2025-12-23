import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Stub API route for subscription status
// TODO: Implement with actual subscription check from Stripe/Supabase
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // For now, return no active subscription
    // TODO: Check actual subscription status from database
    return NextResponse.json({
      data: {
        active: false,
        subscriptionId: null,
        customerId: null,
        priceId: null,
        status: 'inactive',
      },
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}




