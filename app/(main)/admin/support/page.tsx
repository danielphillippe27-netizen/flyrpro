import { requireFounder } from '@/lib/auth/requireFounder';
import { SupportInbox } from '@/components/support';

export default async function AdminSupportPage() {
  await requireFounder();

  return (
    <SupportInbox
      title="Support Inbox"
      description="Reply to user messages (founder access)"
    />
  );
}
