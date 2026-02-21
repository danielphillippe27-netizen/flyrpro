'use client';

import { HomeDashboardView } from '@/components/home/HomeDashboardView';

export function MemberDashboardView() {
  return (
    <HomeDashboardView canCreateCampaign={false} />
  );
}
