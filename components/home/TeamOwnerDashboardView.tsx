'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TeamControlsBar, type TeamControlsRange } from '@/components/home/team/TeamControlsBar';
import { TeamMapTab } from '@/components/home/team/TeamMapTab';
import { TeamActivityTab } from '@/components/home/team/TeamActivityTab';
import { TeamDashboardTab } from '@/components/home/team/TeamDashboardTab';
import { TeamMembersTab } from '@/components/home/team/TeamMembersTab';
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
  const [mapMode, setMapMode] = useState<'routes' | 'knocked_homes'>('routes');
  const [members, setMembers] = useState<{ user_id: string; display_name: string; color?: string }[]>([]);
  const [selectedMember, setSelectedMember] = useState<{ user_id: string; display_name: string; color: string } | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!currentWorkspaceId) {
      setMembers([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/team/map?workspaceId=${encodeURIComponent(currentWorkspaceId)}&limit=50`
      );
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
      }
    } catch {
      setMembers([]);
    }
  }, [currentWorkspaceId]);

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
          showMapMode={activeTab === 'map'}
          mapMode={mapMode}
          onMapModeChange={setMapMode}
        />
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="map">Map</TabsTrigger>
          </TabsList>
          <TabsContent value="summary">
            <TeamDashboardTab
              range={range}
              memberIds={memberIds}
              onMemberClick={(m) => setSelectedMember({ ...m, color: m.color ?? '#3B82F6' })}
              onOpenMap={() => {
                setActiveTab('map');
                setMapMode('knocked_homes');
              }}
            />
          </TabsContent>
          <TabsContent value="activity">
            <TeamActivityTab range={range} memberIds={memberIds} />
          </TabsContent>
          <TabsContent value="members">
            <TeamMembersTab
              range={range}
              onMemberClick={(m) => setSelectedMember({ ...m, color: m.color ?? '#3B82F6' })}
            />
          </TabsContent>
          <TabsContent value="map">
            <TeamMapTab range={range} memberIds={memberIds} mapMode={mapMode} />
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
