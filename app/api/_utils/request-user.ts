import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';

export type RequestUser = {
  id: string;
  email: string | null;
};

/**
 * Resolve authenticated user from either:
 * 1) Authorization: Bearer <access-token> (iOS/native clients), or
 * 2) Supabase auth cookies (web).
 */
export async function resolveUserFromRequest(
  request: NextRequest
): Promise<RequestUser | null> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const authHeader = request.headers.get('authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const bearerClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const {
        data: { user },
        error,
      } = await bearerClient.auth.getUser();
      if (!error && user) {
        return { id: user.id, email: user.email ?? null };
      }
    }
  }

  const cookieStore = await cookies();
  const cookieClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
    error,
  } = await cookieClient.auth.getUser();

  if (error || !user) return null;
  return { id: user.id, email: user.email ?? null };
}

