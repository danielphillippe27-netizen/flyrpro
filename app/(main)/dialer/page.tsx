import { requireSalesperson } from '@/lib/auth/requireSalesperson';
import { PowerDialerPage } from '@/components/dialer/PowerDialerPage';

export default async function DialerRoute() {
  await requireSalesperson();
  return <PowerDialerPage />;
}
