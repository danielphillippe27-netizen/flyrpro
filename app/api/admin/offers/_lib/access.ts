import type { User } from '@supabase/supabase-js';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminClient>;

type SalespersonAccessRow = {
  id: string;
  full_name: string;
  email: string;
  status: string;
};

export type OfferAccessAuth =
  | {
      ok: true;
      user: User;
      admin: AdminClient;
      isFounder: boolean;
      salesperson: SalespersonAccessRow | null;
    }
  | { ok: false; status: number; error: string };

export async function requireOfferAccessApi(): Promise<OfferAccessAuth> {
  const authClient = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const { data: isFounder, error: founderError } = await authClient.rpc('is_founder');
  const founder = !founderError && Boolean(isFounder);
  const admin = createAdminClient();

  if (founder) {
    return {
      ok: true,
      user,
      admin,
      isFounder: true,
      salesperson: null,
    };
  }

  const normalizedEmail = user.email?.trim().toLowerCase() ?? null;
  const salespersonLookup = normalizedEmail
    ? await admin
        .from('salespeople')
        .select('id, full_name, email, status')
        .eq('email', normalizedEmail)
        .eq('status', 'active')
        .maybeSingle()
    : { data: null, error: null };

  if (salespersonLookup.error || !salespersonLookup.data) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return {
    ok: true,
    user,
    admin,
    isFounder: false,
    salesperson: salespersonLookup.data as SalespersonAccessRow,
  };
}
