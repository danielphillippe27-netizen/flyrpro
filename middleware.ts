import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';
import { withSharedWolfGridCookie } from '@/lib/supabase/shared-cookie';

let loggedConfigError = false;

const CANONICAL_HOST = 'wolfgrid.app';
const LEGACY_HOSTS = new Set([
  'flyrpro.app',
  'www.flyrpro.app',
  'www.wolfgrid.app',
]);

export async function middleware(req: NextRequest) {
  const host = req.nextUrl.hostname.toLowerCase();
  if (LEGACY_HOSTS.has(host)) {
    const redirectURL = req.nextUrl.clone();
    redirectURL.protocol = 'https:';
    redirectURL.hostname = CANONICAL_HOST;
    redirectURL.port = '';
    return NextResponse.redirect(redirectURL, 308);
  }

  // Public auth pages must not repeatedly refresh an already-invalid token.
  // The login page creates a fresh session, and the callback persists it.
  if (req.nextUrl.pathname === '/login' || req.nextUrl.pathname.startsWith('/password/')) {
    return NextResponse.next();
  }

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
              res.cookies.set(name, value, withSharedWolfGridCookie(req.nextUrl.hostname, options))
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
  // Run on application routes, never on static files such as logos and fonts.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[a-zA-Z0-9]+$).*)'],
};
