import type { Metadata } from 'next';
import { DemoFunnel } from '@/components/landing/DemoFunnel';

export const metadata: Metadata = {
  title: 'Mobile Demo | WolfGrid',
  description: 'See how WolfGrid helps canvassing and field sales teams launch campaigns, track reps, and follow up faster.',
  alternates: {
    canonical: '/demo',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function DemoPage() {
  return <DemoFunnel />;
}
