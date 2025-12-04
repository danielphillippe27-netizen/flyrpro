import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Stub API route for billing
// TODO: Implement with Stripe Checkout
export async function POST(request: NextRequest) {
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

    // For now, redirect to settings page
    // TODO: Create Stripe Checkout session
    const redirectUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/settings`;
    
    return NextResponse.json({
      data: redirectUrl,
    });
  } catch (error) {
    console.error('Error creating billing session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

