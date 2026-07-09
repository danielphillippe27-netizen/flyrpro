import { Suspense } from 'react';
import { FeedbackInbox } from '@/components/admin/FeedbackInbox';
import { requireFounder } from '@/lib/auth/requireFounder';

export default async function AdminFeedbackPage() {
  await requireFounder();
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading feedback...</div>}>
      <FeedbackInbox />
    </Suspense>
  );
}
