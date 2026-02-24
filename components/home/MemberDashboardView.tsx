'use client';

import { HomeDashboardView } from '@/components/home/HomeDashboardView';

export function MemberDashboardView() {
  return (
    <div className="space-y-6">
      <HomeDashboardView canCreateCampaign={false} />
    </div>
  );
}
