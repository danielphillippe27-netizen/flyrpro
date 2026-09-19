import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';

/** Keep auth.uid() intact for database-enforced permissions on web and native. */
export async function requestSupabase(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return getSupabaseServerClient();
}
