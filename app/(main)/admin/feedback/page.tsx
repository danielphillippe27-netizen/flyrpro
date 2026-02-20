import { FeedbackInbox } from '@/components/admin/FeedbackInbox';
import { requireFounder } from '@/lib/auth/requireFounder';

export default async function AdminFeedbackPage() {
  await requireFounder();
  return <FeedbackInbox />;
}
