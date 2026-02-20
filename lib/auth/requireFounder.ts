import { redirect, notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { User } from '@supabase/supabase-js';

/**
 * Server-only guard: ensures the current user is authenticated and has founder entitlement.
 * Use at the top of founder-only pages (e.g. /admin, /admin/support).
 * - No user -> redirect to /login
 * - Not founder -> notFound() (404)
 * @returns { user } for use in the page
 */
export async function requireFounder(): Promise<{ user: User }> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/login');
  }

  const { data: isFounder, error: rpcError } = await supabase.rpc('is_founder');

  if (rpcError || !isFounder) {
    notFound();
  }

  return { user };
}
