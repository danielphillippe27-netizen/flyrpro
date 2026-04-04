'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TeamControlsBar, type TeamControlsRange } from '@/components/home/team/TeamControlsBar';
import { TeamActivityTab } from '@/components/home/team/TeamActivityTab';
import { TeamDashboardTab } from '@/components/home/team/TeamDashboardTab';
import { TeamSettingsTab } from '@/components/home/team/TeamSettingsTab';
import { MemberDetailDrawer } from '@/components/home/team/MemberDetailDrawer';
import { useWorkspace } from '@/lib/workspace-context';

function getInitialRange(): TeamControlsRange {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  return {
    preset: '7d',
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function TeamOwnerDashboardView() {
  const { currentWorkspaceId } = useWorkspace();
  const [activeTab, setActiveTab] = useState('summary');
  const [range, setRange] = useState<TeamControlsRange>(getInitialRange);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [members, setMembers] = useState<{ user_id: string; display_name: string; color?: string }[]>([]);
  const [selectedMember, setSelectedMember] = useState<{ user_id: string; display_name: string; color: string } | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!currentWorkspaceId) {
      setMembers([]);
      return;
    }
    try {
      const query = new URLSearchParams({
        workspaceId: currentWorkspaceId,
        start: range.start,
        end: range.end,
      });
      const res = await fetch(
        `/api/team/members?${query.toString()}`
      );
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
      }
    } catch {
      setMembers([]);
    }
  }, [currentWorkspaceId, range.end, range.start]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground mb-4 text-center">Team dashboard</h1>
        <TeamControlsBar
          range={range}
          onRangeChange={setRange}
          memberIds={memberIds}
          onMemberFilterChange={setMemberIds}
          members={members}
        />
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4 gap-1 bg-transparent p-0">
            <TabsTrigger
              value="summary"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Summary
            </TabsTrigger>
            <TabsTrigger
              value="activity"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Activity
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Settings
            </TabsTrigger>
          </TabsList>
          <TabsContent value="summary">
            <TeamDashboardTab
              range={range}
              memberIds={memberIds}
              onMemberClick={(m) => setSelectedMember({ ...m, color: m.color ?? '#3B82F6' })}
            />
          </TabsContent>
          <TabsContent value="activity">
            <TeamActivityTab range={range} memberIds={memberIds} />
          </TabsContent>
          <TabsContent value="settings">
            <TeamSettingsTab
              range={range}
              onMemberClick={(m) => setSelectedMember({ ...m, color: m.color ?? '#3B82F6' })}
            />
          </TabsContent>
        </Tabs>
        <MemberDetailDrawer
          open={!!selectedMember}
          onOpenChange={(open) => !open && setSelectedMember(null)}
          member={selectedMember}
          workspaceId={currentWorkspaceId}
          range={range}
        />
      </div>
    </div>
  );
}
