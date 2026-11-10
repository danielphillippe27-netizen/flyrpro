import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { LeadRecordPageView } from '@/components/crm/LeadRecordPageView';

export default async function LeadRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { contactId } = await params;
  const { view } = await searchParams;
  if (view !== 'classic' && z.string().uuid().safeParse(contactId).success) {
    const api = await getSupabaseServerClient();
    const { data: { user } } = await api.auth.getUser();
    if (!user) redirect('/login');
    const { data: record } = await api.from('contacts').select('id,workspace_id')
      .eq('id', contactId).eq('user_id', user.id).maybeSingle();
    if (record?.workspace_id) redirect(`/contacts?contact=${contactId}`);
  }
  return <LeadRecordPageView contactId={contactId} />;
}
