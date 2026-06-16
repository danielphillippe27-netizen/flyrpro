import { Beat1 } from '@/components/demo/beats/Beat1';
import { Beat2 } from '@/components/demo/beats/Beat2';
import { Beat6 } from '@/components/demo/beats/Beat6';
import { DemoShell } from '@/components/demo/DemoShell';
import { DEFAULT_PAYLOAD } from '@/lib/demo/defaults';

export default function DemoPage() {
  const payload = DEFAULT_PAYLOAD;

  return (
    <DemoShell>
      <Beat1 copy={payload.copy} center={payload.center} />
      <Beat2 copy={payload.copy} />
      <Beat6 copy={payload.copy} ctaVariant={payload.ctaVariant} ctaUrl={payload.ctaUrl} />
    </DemoShell>
  );
}
