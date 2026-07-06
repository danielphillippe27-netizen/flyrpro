import { Suspense } from 'react';
import { requireFounder } from '@/lib/auth/requireFounder';
import { SalespeopleDashboard } from '@/components/admin/SalespeopleDashboard';

type SalespeoplePageProps = {
  searchParams?: Promise<{
    stripeOnboarding?: string;
  }>;
};

export default async function SalespeoplePage({ searchParams }: SalespeoplePageProps) {
  await requireFounder();

  const params = await searchParams;
  const stripeOnboarding = params?.stripeOnboarding;
  const stripeNotice =
    stripeOnboarding === 'complete'
      ? 'Stripe onboarding received. Payout readiness will update after Stripe confirms the account.'
      : stripeOnboarding === 'refresh'
        ? 'That Stripe onboarding link expired or was already used. Create a fresh link for the salesperson.'
        : null;

  return (
    <Suspense fallback={null}>
      <SalespeopleDashboard stripeNotice={stripeNotice} />
    </Suspense>
  );
}
