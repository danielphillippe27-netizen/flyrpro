import { redirect } from 'next/navigation';
import { requireFounder } from '@/lib/auth/requireFounder';

export const dynamic = 'force-dynamic';

export default async function AdminOffersRedirectPage() {
  await requireFounder();
  redirect('/offers');
}
