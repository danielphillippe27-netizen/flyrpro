import { redirect } from 'next/navigation';
import { requireFounder } from '@/lib/auth/requireFounder';

export default async function AdminOffersRedirectPage() {
  await requireFounder();
  redirect('/offers');
}
