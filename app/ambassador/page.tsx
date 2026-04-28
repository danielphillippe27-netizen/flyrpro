import { AmbassadorProgramSection } from '@/components/landing/AmbassadorProgramSection';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';

export default function AmbassadorPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PublicSiteHeader active="ambassador" />

      <main>
        <AmbassadorProgramSection />
      </main>
    </div>
  );
}
