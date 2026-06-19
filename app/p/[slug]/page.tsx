import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { PublicAmbassadorLanding } from '@/components/ambassador/PublicAmbassadorLanding';
import { loadPublicAmbassadorLandingBySlug } from '@/app/lib/ambassador/public-landing';
import { isMissingAmbassadorSchemaError } from '@/app/lib/billing/ambassador-program';
import { sanitizeTrackingParam } from '@/app/lib/ambassador/portal';

type PartnerPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{
    source?: string;
    campaign?: string;
  }>;
};

export default async function PartnerLandingPage({ params, searchParams }: PartnerPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const admin = createAdminClient();
  const landingPage = await loadPublicAmbassadorLandingBySlug(admin, slug);

  if (!landingPage) {
    notFound();
  }

  await admin
    .from('ambassador_landing_page_events')
    .insert({
      ambassador_application_id: landingPage.ambassador.id,
      landing_page_id: landingPage.id,
      slug: landingPage.slug,
      event_type: 'view',
      source: sanitizeTrackingParam(query?.source),
      campaign: sanitizeTrackingParam(query?.campaign),
    })
    .then(({ error }) => {
      if (error && !isMissingAmbassadorSchemaError(error.message)) {
        console.warn('[partner landing page] view tracking failed', error);
      }
      if (!error || !isMissingAmbassadorSchemaError(error.message)) return null;
      return admin.from('ambassador_landing_page_events').insert({
        ambassador_application_id: landingPage.ambassador.id,
        landing_page_id: landingPage.id,
        slug: landingPage.slug,
        event_type: 'view',
      });
    });

  return (
    <PublicAmbassadorLanding
      landingPage={landingPage}
      source={query?.source}
      campaign={query?.campaign}
    />
  );
}
