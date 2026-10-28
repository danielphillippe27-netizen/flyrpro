import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import MacSettingsClient from './MacSettingsClient';

export const dynamic = 'force-dynamic';
export default async function MacSettingsPage() {
  const api = await getSupabaseServerClient();
  const { data: { user } } = await api.auth.getUser();
  if (!user) redirect('/login?next=/settings/mac');
  return <MacSettingsClient />;
}
