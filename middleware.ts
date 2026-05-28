import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';

let loggedConfigError = false;

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  
  try {
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();

    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              req.cookies.set(name, value)
            );
            cookiesToSet.forEach(({ name, value, options }) =>
              res.cookies.set(name, value, options)
            );
          },
        },
      }
    );
    
    // Just refresh the session - don't redirect or make DB calls
    await supabase.auth.getSession();
  } catch (error) {
    // Avoid 500s if env vars are missing, but log once so misconfig is visible.
    if (!loggedConfigError) {
      console.error('Middleware Supabase setup error:', error);
      loggedConfigError = true;
    }
  }
  
  return res;
}

export const config = {
  // Run on everything except static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
