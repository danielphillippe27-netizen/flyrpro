import { getSupabaseServerClient } from '@/lib/supabase/server';
import { canUseInbox } from '@/lib/coco/inbox-access';
import MainLayoutClient from '@/app/(main)/MainLayoutClient';
import { FarmsLayoutClient } from '@/components/farms/FarmsLayoutClient';

export default async function FarmsRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <MainLayoutClient canUseInbox={canUseInbox(user?.email)}>
      <FarmsLayoutClient>{children}</FarmsLayoutClient>
    </MainLayoutClient>
  );
}
