import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') || '/home';

  console.log('🔐 Auth Callback:', {
    origin: requestUrl.origin,
    code: code ? 'present' : 'missing',
    next,
    fullUrl: requestUrl.toString(),
  });

  // Create response object to set cookies
  // Use requestUrl.origin to ensure we stay on the same domain
  const redirectUrl = new URL(next, requestUrl.origin);
  const response = NextResponse.redirect(redirectUrl);

  if (code) {
    try {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value, options }) => {
                // Set cookies in both request and response
                request.cookies.set(name, value);
                response.cookies.set(name, value, options);
              });
            },
          },
        }
      );

      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error('❌ Code exchange error:', error);
        // Redirect to login with error message
        const loginUrl = new URL('/login', requestUrl.origin);
        loginUrl.searchParams.set('error', 'auth_failed');
        return NextResponse.redirect(loginUrl);
      }

      console.log('✅ Code exchange successful, redirecting to:', redirectUrl.toString());
      // Successfully exchanged code for session, redirect to next page
      return response;
    } catch (error) {
      console.error('❌ Callback route error:', error);
      const loginUrl = new URL('/login', requestUrl.origin);
      loginUrl.searchParams.set('error', 'callback_error');
      return NextResponse.redirect(loginUrl);
    }
  }

  // If no code, redirect to login
  console.warn('⚠️ No code parameter in callback URL');
  return NextResponse.redirect(new URL('/login', requestUrl.origin));
}

