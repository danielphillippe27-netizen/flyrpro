import { requireFounder } from '@/lib/auth/requireFounder';
import { FounderDashboard } from '@/components/admin/FounderDashboard';

export default async function AdminPage() {
  await requireFounder();

  return <FounderDashboard />;
}
