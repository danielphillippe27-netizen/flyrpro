import { requireSalesperson } from '@/lib/auth/requireSalesperson';
import { ScriptsPage } from '@/components/scripts/ScriptsPage';

export default async function ScriptsRoute() {
  await requireSalesperson();
  return <ScriptsPage />;
}
