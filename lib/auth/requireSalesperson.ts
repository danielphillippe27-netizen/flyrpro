import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel } from '@/app/api/_utils/workspace';
import { resolveSalespersonForUser } from '@/lib/dialer/salesperson-settings';
import type { User } from '@supabase/supabase-js';

/**
 * Server-only guard: ensures the current user is an active salesperson.
 * Use at the top of salesperson-only pages (/dialer, /scraper, /inbox, /scripts, etc.)
 *
 * - No user             → redirect to /login
 * - Workspace owner/admin → redirect to /home  (owners are never salespersons)
 * - Not in salespeople table → redirect to /home
 *
 * @returns { user } for use in the page
 */
export async function requireSalesperson(): Promise<{ user: User }> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/login');
  }

  const admin = createAdminClient();
  const access = await resolveDashboardAccessLevel(admin, user.id);

  // Founders have their own world; owners/admins are never salespersons
  if (access.isFounder || access.role === 'owner' || access.role === 'admin') {
    redirect('/home');
  }

  const salesperson = await resolveSalespersonForUser(admin, {
    userId: user.id,
    email: user.email?.trim().toLowerCase() ?? null,
    workspaceId: access.workspaceId,
  });

  if (!salesperson) {
    redirect('/home');
  }

  return { user };
}
