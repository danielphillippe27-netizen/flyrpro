import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/home';
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description') ?? '';

  if (code) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const gateUrl = new URL('/gate', origin);
      if (next && next !== '/home') gateUrl.searchParams.set('next', next);
      return NextResponse.redirect(gateUrl.toString());
    }

    console.error('Auth callback error:', error);
    const loginUrl = new URL('/login', origin);
    if (error.message?.includes('code verifier') || (error as { code?: string }).code === 'pkce_code_verifier_not_found') {
      loginUrl.searchParams.set('error', 'pkce_verifier_mismatch');
    } else {
      loginUrl.searchParams.set('error', 'auth_failed');
    }
    return NextResponse.redirect(loginUrl);
  }

  // No code: e.g. Apple/Google error or user cancelled
  const loginUrl = new URL('/login', origin);
  if (errorParam) {
    loginUrl.searchParams.set('error', errorParam === 'access_denied' ? 'apple_exchange_failed' : 'auth_failed');
    if (errorDescription) loginUrl.searchParams.set('error_description', errorDescription);
  }
  return NextResponse.redirect(loginUrl);
}

