import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';

let loggedConfigError = false;

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith('/demo/admin') || pathname.startsWith('/api/demo-links')) {
    if (!hasValidDemoAdminAuth(req)) {
      return new NextResponse('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="FLYR Demo Admin"',
        },
      });
    }

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

function hasValidDemoAdminAuth(req: NextRequest) {
  const expectedUser = process.env.DEMO_ADMIN_USER;
  const expectedPassword = process.env.DEMO_ADMIN_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return false;
  }

  const header = req.headers.get('authorization');
  if (!header?.startsWith('Basic ')) {
    return false;
  }

  try {
    const decoded = atob(header.slice('Basic '.length));
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) {
      return false;
    }

    const user = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    return user === expectedUser && password === expectedPassword;
  } catch {
    return false;
  }
}
