import { notFound, redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { resolveSalespersonForUser } from '@/lib/dialer/salesperson-settings';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminClient>;

export async function isFlyrSalesperson(
  admin: AdminClient,
  userId: string,
  email?: string | null
): Promise<boolean> {
  try {
    const salesperson = await resolveSalespersonForUser(admin, {
      userId,
      email,
    });
    return Boolean(salesperson?.id);
  } catch (error) {
    console.error('[flyr-internal-auth] Salesperson lookup failed:', error);
    return false;
  }
}

export async function isFlyrFounder(
  admin: AdminClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('is_founder')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[flyr-internal-auth] Founder lookup failed:', error);
    return false;
  }

  return data?.is_founder === true;
}

export async function hasFlyrDemoAdminAccess(
  admin: AdminClient,
  userId: string,
  email?: string | null
): Promise<boolean> {
  const [isSalesperson, isFounder] = await Promise.all([
    isFlyrSalesperson(admin, userId, email),
    isFlyrFounder(admin, userId),
  ]);

  return isSalesperson || isFounder;
}

/**
 * Server-only guard for internal WolfGrid demo tooling.
 * Unauthenticated users go to login; authenticated non-salespeople/non-founders get a 404.
 */
export async function requireFlyrDemoAdminAccess(): Promise<{ user: User }> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/login');
  }

  const admin = createAdminClient();
  const allowed = await hasFlyrDemoAdminAccess(admin, user.id, user.email);
  if (!allowed) {
    notFound();
  }

  return { user };
}
