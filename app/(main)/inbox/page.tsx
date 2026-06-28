import { requireSalesperson } from '@/lib/auth/requireSalesperson';
import { InboxPageView } from '@/components/inbox/InboxPageView';

export default async function InboxPage() {
  await requireSalesperson();
  return <InboxPageView />;
}
