import { Beat1 } from '@/components/demo/beats/Beat1';
import { Beat2 } from '@/components/demo/beats/Beat2';
import { Beat3 } from '@/components/demo/beats/Beat3';
import { Beat4 } from '@/components/demo/beats/Beat4';
import { Beat5 } from '@/components/demo/beats/Beat5';
import { Beat6 } from '@/components/demo/beats/Beat6';
import { DemoShell } from '@/components/demo/DemoShell';
import { resolvePayloadForSlug } from '@/lib/demo/resolvePayload';

type DemoPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function DemoPage({ params }: DemoPageProps) {
  const { slug } = await params;
  const payload = await resolvePayloadForSlug(slug);

  return (
    <DemoShell slug={payload.slug}>
      <Beat1 copy={payload.copy} center={payload.center} />
      <Beat2 copy={payload.copy} />
      <Beat3 copy={payload.copy} center={payload.center} company={payload.company} city={payload.city} />
      <Beat4 copy={payload.copy} />
      <Beat5 copy={payload.copy} />
      <Beat6 copy={payload.copy} ctaVariant={payload.ctaVariant} ctaUrl={payload.ctaUrl} />
    </DemoShell>
  );
}
