import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { browserAuthCookies } from './browser-cookies';
import { browserSharedCookieOptions } from '@/lib/supabase/shared-cookie';

/**
 * Browser Supabase client. Stores PKCE code verifier in cookies (via @supabase/ssr)
 * so the callback route can read it. Use this when initiating OAuth (Google, Apple).
 */
export function createClient(): SupabaseClient {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: browserSharedCookieOptions(),
      ...(typeof document !== 'undefined' ? { cookies: browserAuthCookies } : {}),
    }
  );
}

/**
 * Use in useEffect only (browser). Defers client creation to avoid auth-js
 * "Cannot read properties of undefined (reading 'call')" during hydration.
 */
export function getClientAsync(): Promise<SupabaseClient> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('getClientAsync() must only be called in the browser.'));
  }
  return new Promise((resolve, reject) => {
    const run = () => {
      try {
        resolve(createClient());
      } catch (err) {
        reject(err);
      }
    };
    // Deferring to a task still avoids hydration-time initialization, without
    // waiting for an animation frame that hidden browser tabs may never render.
    setTimeout(run, 0);
  });
}
