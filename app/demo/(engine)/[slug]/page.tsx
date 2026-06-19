import { Beat1 } from '@/components/demo/beats/Beat1';
import { Beat2 } from '@/components/demo/beats/Beat2';
import { Beat3 } from '@/components/demo/beats/Beat3';
import { Beat4 } from '@/components/demo/beats/Beat4';
import { Beat5 } from '@/components/demo/beats/Beat5';
import { Beat6 } from '@/components/demo/beats/Beat6';
import { BeatErrorBoundary } from '@/components/demo/BeatErrorBoundary';
import { DemoShell } from '@/components/demo/DemoShell';
import {
  StaticBeat1Fallback,
  StaticBeat2Fallback,
  StaticBeat3Fallback,
  StaticBeat4Fallback,
  StaticBeat5Fallback,
  StaticBeat6Fallback,
} from '@/components/demo/beats/StaticBeatFallbacks';
import { resolvePayloadForSlug } from '@/lib/demo/resolvePayload';

type DemoPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function DemoPage({ params }: DemoPageProps) {
  const { slug } = await params;
  const payload = await resolvePayloadForSlug(slug);

  return (
    <DemoShell slug={payload.slug} ctaVariant={payload.ctaVariant}>
      <BeatErrorBoundary beatId="1" fallback={<StaticBeat1Fallback copy={payload.copy} />}>
        <Beat1 copy={payload.copy} center={payload.center} />
      </BeatErrorBoundary>
      <BeatErrorBoundary beatId="2" fallback={<StaticBeat2Fallback copy={payload.copy} />}>
        <Beat2 copy={payload.copy} />
      </BeatErrorBoundary>
      <BeatErrorBoundary beatId="3" fallback={<StaticBeat3Fallback copy={payload.copy} />}>
        <Beat3 copy={payload.copy} center={payload.center} company={payload.company} city={payload.city} />
      </BeatErrorBoundary>
      <BeatErrorBoundary beatId="4" fallback={<StaticBeat4Fallback copy={payload.copy} />}>
        <Beat4 copy={payload.copy} center={payload.center} />
      </BeatErrorBoundary>
      <BeatErrorBoundary beatId="5" fallback={<StaticBeat5Fallback copy={payload.copy} />}>
        <Beat5 copy={payload.copy} />
      </BeatErrorBoundary>
      <BeatErrorBoundary
        beatId="6"
        fallback={<StaticBeat6Fallback copy={payload.copy} ctaVariant={payload.ctaVariant} ctaUrl={payload.ctaUrl} />}
      >
        <Beat6 copy={payload.copy} ctaVariant={payload.ctaVariant} ctaUrl={payload.ctaUrl} />
      </BeatErrorBoundary>
    </DemoShell>
  );
}
