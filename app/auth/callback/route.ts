import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

function isOnboardingPath(next: string | null): boolean {
  return typeof next === 'string' && next.startsWith('/onboarding');
}

function buildErrorRedirectUrl(
  origin: string,
  next: string,
  options: {
    error: string;
    errorDescription?: string;
    inviteToken?: string | null;
    workspaceIntent?: string | null;
  }
) {
  const target = new URL(isOnboardingPath(next) ? next : '/login', origin);
  target.searchParams.set('error', options.error);
  if (options.errorDescription) {
    target.searchParams.set('error_description', options.errorDescription);
  }
  if (!isOnboardingPath(next) && next && next !== '/home') {
    target.searchParams.set('next', next);
  }
  if (options.inviteToken?.trim()) {
    target.searchParams.set('token', options.inviteToken.trim());
  }
  if (options.workspaceIntent?.trim()) {
    target.searchParams.set('workspace', options.workspaceIntent.trim());
  }
  return target;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/home';
  const inviteToken = searchParams.get('token');
  const workspaceIntent = searchParams.get('workspace');
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
      if (isOnboardingPath(next)) {
        return NextResponse.redirect(new URL(next, origin));
      }
      const gateUrl = new URL('/gate', origin);
      if (next && next !== '/home') gateUrl.searchParams.set('next', next);
      if (inviteToken?.trim()) gateUrl.searchParams.set('token', inviteToken.trim());
      if (workspaceIntent?.trim()) gateUrl.searchParams.set('workspace', workspaceIntent.trim());
      return NextResponse.redirect(gateUrl.toString());
    }

    console.error('Auth callback error:', error);
    return NextResponse.redirect(
      buildErrorRedirectUrl(origin, next, {
        error:
          error.message?.includes('code verifier') ||
          (error as { code?: string }).code === 'pkce_code_verifier_not_found'
            ? 'pkce_verifier_mismatch'
            : 'auth_failed',
        inviteToken,
        workspaceIntent,
      })
    );
  }

  // No code: e.g. Apple/Google error or user cancelled
  return NextResponse.redirect(
    buildErrorRedirectUrl(origin, next, {
      error: errorParam === 'access_denied' ? 'apple_exchange_failed' : 'auth_failed',
      errorDescription,
      inviteToken,
      workspaceIntent,
    })
  );
}
