import { AmbassadorProgramSection } from '@/components/landing/AmbassadorProgramSection';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';

type AmbassadorPageProps = {
  searchParams?: Promise<{
    stripeOnboarding?: string;
  }>;
};

export default async function AmbassadorPage({ searchParams }: AmbassadorPageProps) {
  const params = await searchParams;
  const stripeOnboarding = params?.stripeOnboarding;
  const stripeNotice =
    stripeOnboarding === 'complete'
      ? 'Stripe onboarding received. We will review payout readiness and follow up from FLYR.'
      : stripeOnboarding === 'refresh'
        ? 'That Stripe onboarding link expired or was already used. Please ask FLYR for a fresh link.'
        : null;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PublicSiteHeader active="ambassador" />

      <main>
        {stripeNotice ? (
          <section className="border-b border-zinc-200 bg-white">
            <div className="mx-auto max-w-5xl px-4 py-4 text-sm font-medium text-zinc-700 sm:px-6 lg:px-8">
              {stripeNotice}
            </div>
          </section>
        ) : null}
        <AmbassadorProgramSection />
      </main>
    </div>
  );
}
