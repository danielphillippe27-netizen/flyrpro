import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

function safeRedirectPath(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string' || !value.startsWith('/gate')) return '/gate?next=%2Fhome';
  return value;
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const redirectPath = safeRedirectPath(form.get('redirect'));

  if (!email || password.length < 6) {
    return NextResponse.redirect(new URL('/login?error=invalid_credentials', request.url), 303);
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const loginURL = new URL('/login', request.url);
    loginURL.searchParams.set('error', 'invalid_credentials');
    return NextResponse.redirect(loginURL, 303);
  }

  return NextResponse.redirect(new URL(redirectPath, request.url), 303);
}
