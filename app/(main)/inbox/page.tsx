import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { canUseInbox } from '@/lib/coco/inbox-access';
import { requireSalesperson } from '@/lib/auth/requireSalesperson';
import { InboxPageView } from '@/components/inbox/InboxPageView';

export default async function InboxPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!canUseInbox(user.email)) redirect('/leads');
  await requireSalesperson();
  return <InboxPageView />;
}
