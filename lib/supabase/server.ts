import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from '@/lib/supabase/env';

function isTransientSupabaseFetchError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const message = `${candidate.message ?? ''} ${candidate.cause?.message ?? ''}`.toLowerCase();
  return (
    candidate.code === 'ERR_HTTP2_INVALID_SESSION' ||
    candidate.cause?.code === 'ERR_HTTP2_INVALID_SESSION' ||
    message.includes('fetch failed') ||
    message.includes('session has been destroyed')
  );
}

async function retryingSupabaseFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const requestInput =
        typeof Request !== 'undefined' && input instanceof Request
          ? input.clone()
          : input;
      return await fetch(requestInput, init);
    } catch (error) {
      lastError = error;
      if (!isTransientSupabaseFetchError(error) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }

  throw lastError;
}

export function createAdminClient() {
  const supabaseUrl = getSupabaseUrl();
  const supabaseServiceKey = getSupabaseServiceRoleKey();

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: retryingSupabaseFetch,
    },
  });
}

/**
 * Create a server-side Supabase client for use in API routes and server components.
 * Uses the authenticated user's session from cookies.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
