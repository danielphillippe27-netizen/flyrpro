import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

function isSafeNextPath(value: string | null): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

function requestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(':', '') || 'http';
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Missing Supabase environment variables' }, { status: 500 });
  }

  const { searchParams } = request.nextUrl;
  const email = searchParams.get('email')?.trim().toLowerCase() ?? '';
  const password = searchParams.get('password') ?? '';
  const next = searchParams.get('next');

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const redirectPath = isSafeNextPath(next) ? next : '/home';
  // Preserve the incoming hostname. Switching 127.0.0.1 to localhost (or vice versa) drops
  // Supabase's host-only auth cookie and makes the following page appear signed out.
  const response = NextResponse.redirect(new URL(redirectPath, requestOrigin(request)));

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        status: error.status ?? 500,
      },
      { status: error.status ?? 500 }
    );
  }

  return response;
}
