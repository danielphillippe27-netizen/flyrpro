import { LeadRecordPageView } from '@/components/crm/LeadRecordPageView';

export default async function LeadRecordPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  return <LeadRecordPageView contactId={contactId} />;
}
