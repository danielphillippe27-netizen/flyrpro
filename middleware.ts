import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
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
  } catch (_) {
    // Swallow errors to avoid 500s
  }
  
  return res;
}

export const config = {
  // Run on everything except static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};

