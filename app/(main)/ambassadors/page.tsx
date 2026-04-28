import { requireFounder } from '@/lib/auth/requireFounder';
import { FounderDashboard } from '@/components/admin/FounderDashboard';

export default async function AmbassadorsPage() {
  await requireFounder();

  return <FounderDashboard mode="ambassadors" />;
}
