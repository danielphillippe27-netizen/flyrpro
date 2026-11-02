import { CrmAssistant } from '@/components/crm-ai/CrmAssistant';
import { MacSessionBridge } from '@/components/crm-ai/MacSessionBridge';
import RetiredRecordingCleanup from './RetiredRecordingCleanup';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { canUseInbox } from '@/lib/coco/inbox-access';
import MainLayoutClient from './MainLayoutClient';

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <MainLayoutClient canUseInbox={canUseInbox(user?.email)}><RetiredRecordingCleanup /><MacSessionBridge /><CrmAssistant />{children}</MainLayoutClient>;
}
