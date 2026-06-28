import { requireSalesperson } from '@/lib/auth/requireSalesperson';
import { SalespersonLeaderboardDashboard } from '@/components/admin/SalespersonLeaderboardDashboard';

export default async function SalesLeaderboardPage() {
  await requireSalesperson();
  return <SalespersonLeaderboardDashboard />;
}
