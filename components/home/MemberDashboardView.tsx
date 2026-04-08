'use client';

import { HomeDashboardView } from '@/components/home/HomeDashboardView';
import { MyRouteAssignmentsCard } from '@/components/home/MyRouteAssignmentsCard';

export function MemberDashboardView() {
  return (
    <div className="space-y-6">
      <HomeDashboardView disableGoalEditing />
      <div className="max-w-7xl mx-auto pl-0 pr-4 sm:pr-6 lg:pr-8">
        <MyRouteAssignmentsCard />
      </div>
    </div>
  );
}
