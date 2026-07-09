'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HomeDashboardView } from '@/components/home/HomeDashboardView';
import { MemberDashboardView } from '@/components/home/MemberDashboardView';
import { SalespersonCallHomeView } from '@/components/home/SalespersonCallHomeView';
import { TeamOwnerDashboardView } from '@/components/home/TeamOwnerDashboardView';
import { useWorkspace } from '@/lib/workspace-context';
import type { DashboardAccessLevel } from '@/app/api/_utils/workspace';

type HomePageClientProps = {
  accessLevel: DashboardAccessLevel;
};

export function HomePageClient({ accessLevel }: HomePageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessLevel: workspaceAccessLevel } = useWorkspace();
  const resolvedAccessLevel = workspaceAccessLevel ?? accessLevel;
  const showSelfServeTeamDemo =
    searchParams.get('source') === 'self-serve-demo' &&
    (searchParams.get('tab') === 'map' ||
      searchParams.get('tab') === 'reporting' ||
      searchParams.get('tab') === 'settings');

  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      router.replace(`/auth/callback?code=${code}&next=/home`);
    }
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      {showSelfServeTeamDemo || resolvedAccessLevel === 'team_leader' ? (
        <TeamOwnerDashboardView />
      ) : resolvedAccessLevel === 'salesperson' ? (
        <SalespersonCallHomeView />
      ) : resolvedAccessLevel === 'member' ? (
        <MemberDashboardView />
      ) : (
        <HomeDashboardView />
      )}
    </div>
  );
}
