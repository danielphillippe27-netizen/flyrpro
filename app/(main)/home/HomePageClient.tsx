'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HomeDashboardView } from '@/components/home/HomeDashboardView';
import { TeamOwnerDashboardView } from '@/components/home/TeamOwnerDashboardView';
import type { TeamDashboardMode } from '@/app/api/_utils/workspace';

type HomePageClientProps = {
  mode: TeamDashboardMode;
  workspaceId: string | null;
};

export function HomePageClient({ mode, workspaceId }: HomePageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      router.replace(`/auth/callback?code=${code}&next=/home`);
    }
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      {mode === 'team_owner' ? (
        <TeamOwnerDashboardView />
      ) : (
        <HomeDashboardView onCreateCampaign={() => router.push('/campaigns/create')} />
      )}
    </div>
  );
}
