import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function createAdminClient() {
  // Support both SUPABASE_URL (server-only) and NEXT_PUBLIC_SUPABASE_URL
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbnNud3F5bHNkc2JnbndneHZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDkyNjczMSwiZXhwIjoyMDc2NTAyNzMxfQ.DCCPBeHISbRcz4Z-tSaGvjszB-un0vvp45avmv9YPas';
  
  // Ensure URL doesn't have trailing slash - handle undefined/null safely
  const cleanUrl = supabaseUrl ? supabaseUrl.trim().replace(/\/$/, '') : 'https://kfnsnwqylsdsbgnwgxva.supabase.co';

  return createClient(cleanUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Create a server-side Supabase client for use in API routes and server components.
 * Uses the authenticated user's session from cookies.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbnNud3F5bHNkc2JnbndneHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5MjY3MzEsImV4cCI6MjA3NjUwMjczMX0.k2TZKPi3VxAVpEGggLiROYvfVu2nV_oSqBt2GM4jX-Y';
  
  const cleanUrl = supabaseUrl ? supabaseUrl.trim().replace(/\/$/, '') : 'https://kfnsnwqylsdsbgnwgxva.supabase.co';

  return createServerClient(
    cleanUrl,
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
}

