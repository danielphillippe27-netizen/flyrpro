import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import {
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from '@/lib/supabase/env';

export type RequestUser = {
  id: string;
  email: string | null;
};

type ResolveUserFromRequestOptions = {
  allowQueryToken?: boolean;
  queryTokenParamNames?: string[];
};

function getBearerToken(
  request: NextRequest,
  options?: ResolveUserFromRequestOptions
): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    return token || null;
  }

  if (!options?.allowQueryToken) {
    return null;
  }

  const paramNames = options.queryTokenParamNames?.length
    ? options.queryTokenParamNames
    : ['token', 'access_token'];
  for (const paramName of paramNames) {
    const candidate = request.nextUrl.searchParams.get(paramName)?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

/**
 * Resolve authenticated user from either:
 * 1) Authorization: Bearer <access-token> (iOS/native clients), or
 * 2) Supabase auth cookies (web).
 *
 * Query-token fallback is available for routes that opt in explicitly.
 */
export async function resolveUserFromRequest(
  request: NextRequest,
  options?: ResolveUserFromRequestOptions
): Promise<RequestUser | null> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const token = getBearerToken(request, options);

  if (token) {
    const bearerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error,
    } = await bearerClient.auth.getUser(token);
    if (!error && user) {
      return { id: user.id, email: user.email ?? null };
    }

    // Fallback: verify bearer using service role.
    // This protects iOS API auth if anon key/config drift causes auth.getUser(token) to fail.
    const serviceRoleClient = createClient(
      supabaseUrl,
      getSupabaseServiceRoleKey(),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
    const {
      data: { user: serviceUser },
      error: serviceError,
    } = await serviceRoleClient.auth.getUser(token);
    if (!serviceError && serviceUser) {
      return { id: serviceUser.id, email: serviceUser.email ?? null };
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
