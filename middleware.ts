import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';
import { withSharedWolfGridCookie } from '@/lib/supabase/shared-cookie';
import { landingAuthRedirect } from '@/lib/auth/landing-redirect';

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

  // Providers can fall back to the configured site root. Forward the code
  // before rendering or refreshing auth, so callback exchange never depends
  // on client hydration and retains the initiating verifier cookie.
  if (req.nextUrl.pathname === '/' && req.nextUrl.searchParams.has('code')) {
    const destination = landingAuthRedirect(req.nextUrl.search, '');
    if (destination) return NextResponse.redirect(new URL(destination, req.url));
  }

  // Public auth pages must not repeatedly refresh an already-invalid token.
  // The login page creates a fresh session, and the callback persists it.
  if (
    req.nextUrl.pathname === '/login' ||
    req.nextUrl.pathname === '/auth/callback' ||
    req.nextUrl.pathname === '/reset-password' ||
    req.nextUrl.pathname.startsWith('/password/')
  ) {
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
    const { data: { session } } = await supabase.auth.getSession();
    // Redirect before the main client layout can hide a streamed redirect.
    if (req.nextUrl.pathname === '/settings/mac' && !session) {
      const login = req.nextUrl.clone();
      login.pathname = '/login';
      login.search = '?next=/settings/mac';
      return NextResponse.redirect(login);
    }
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
