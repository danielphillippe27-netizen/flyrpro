import { PartnerOffersManager } from '@/components/admin/PartnerOffersManager';
import { requireFounder } from '@/lib/auth/requireFounder';

export default async function AdminOffersPage() {
  await requireFounder();
  return <PartnerOffersManager />;
}
