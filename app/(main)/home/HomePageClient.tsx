'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HomeDashboardView } from '@/components/home/HomeDashboardView';
import { MemberDashboardView } from '@/components/home/MemberDashboardView';
import { TeamOwnerDashboardView } from '@/components/home/TeamOwnerDashboardView';
import type { DashboardAccessLevel } from '@/app/api/_utils/workspace';

type HomePageClientProps = {
  accessLevel: DashboardAccessLevel;
};

export function HomePageClient({ accessLevel }: HomePageClientProps) {
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
      {accessLevel === 'team_leader' ? (
        <TeamOwnerDashboardView />
      ) : accessLevel === 'member' ? (
        <MemberDashboardView />
      ) : (
        <HomeDashboardView onCreateCampaign={() => router.push('/campaigns/create')} />
      )}
    </div>
  );
}
