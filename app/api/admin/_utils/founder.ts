import type { User } from '@supabase/supabase-js';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

export type FounderApiAuth =
  | { ok: true; user: User; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; status: number; error: string };

/**
 * Require authenticated founder for /api/admin/* routes.
 */
export async function requireFounderApi(): Promise<FounderApiAuth> {
  const authClient = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const { data: isFounder, error: founderError } = await authClient.rpc('is_founder');
  if (founderError || !isFounder) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return {
    ok: true,
    user,
    admin: createAdminClient(),
  };
}
