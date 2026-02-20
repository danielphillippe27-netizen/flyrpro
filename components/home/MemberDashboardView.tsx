'use client';

import { Card, CardContent } from '@/components/ui/card';
import { HomeDashboardView } from '@/components/home/HomeDashboardView';

export function MemberDashboardView() {
  return (
    <div className="space-y-6">
      <div className="max-w-7xl mx-auto pl-0 pr-4 sm:pr-6 lg:pr-8 pt-6">
        <Card className="rounded-xl border border-border">
          <CardContent className="py-4 text-sm text-muted-foreground">
            Member view: team stats and activity are available, while workspace billing and admin
            actions stay with your team leader.
          </CardContent>
        </Card>
      </div>
      <HomeDashboardView canCreateCampaign={false} />
    </div>
  );
}
