'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, BarChart3, MessageSquare } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TeamControlsBar, type TeamControlsRange } from '@/components/home/team/TeamControlsBar';
import { TeamActivityTab } from '@/components/home/team/TeamActivityTab';
import { TeamDashboardTab } from '@/components/home/team/TeamDashboardTab';
import { TeamMapTab } from '@/components/home/team/TeamMapTab';
import { TeamReportingTab } from '@/components/home/team/TeamReportingTab';
import { TeamSettingsTab } from '@/components/home/team/TeamSettingsTab';
import { MemberDetailDrawer } from '@/components/home/team/MemberDetailDrawer';
import { useWorkspace } from '@/lib/workspace-context';

const TAB_VALUES = new Set(['summary', 'map', 'activity', 'reporting', 'settings']);

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentWorkspaceId } = useWorkspace();
  const initialTab = searchParams.get('tab');
  const isSelfServeDemo = searchParams.get('source') === 'self-serve-demo';
  const showDemoLiveMap = isSelfServeDemo && searchParams.get('demoLive') === '1';
  const showDemoReport = isSelfServeDemo && (searchParams.get('demoReport') === '1' || initialTab === 'reporting');
  const campaignId = searchParams.get('campaign');
  const [activeTab, setActiveTab] = useState(
    initialTab && TAB_VALUES.has(initialTab) ? initialTab : 'summary'
  );
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

  useEffect(() => {
    if (!isSelfServeDemo) return;
    const unlockDemo = () => {
      router.replace('/home');
    };
    window.addEventListener('flyr:feedback-submitted', unlockDemo);
    return () => window.removeEventListener('flyr:feedback-submitted', unlockDemo);
  }, [isSelfServeDemo, router]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'summary') {
      params.delete('tab');
    } else {
      params.set('tab', value);
    }
    const query = params.toString();
    router.replace(query ? `/home?${query}` : '/home', { scroll: false });
  };

  const demoGuideStep = useMemo(() => {
    if (!isSelfServeDemo) return null;
    if (activeTab === 'map') {
      return {
        eyebrow: 'Next step 3 of 5',
        title: 'Review the team after they hit the doors',
        description: 'The live map shows the 4 demo reps in the field. Next, open reporting to see the weekly performance.',
        button: 'Open reporting',
        icon: BarChart3,
        action: () => {
          const params = new URLSearchParams(searchParams.toString());
          params.set('tab', 'reporting');
          params.set('source', 'self-serve-demo');
          params.set('demoReport', '1');
          if (campaignId) params.set('campaign', campaignId);
          router.replace(`/home?${params.toString()}`, { scroll: false });
          setActiveTab('reporting');
        },
      };
    }
    if (activeTab === 'reporting') {
      return {
        eyebrow: 'Next step 5 of 5',
        title: 'Leave a demo review or ask us anything',
        description: 'Open Feedback ? and send a quick note to unlock the full dashboard.',
        button: 'Open Feedback ?',
        icon: MessageSquare,
        action: () => {
          window.dispatchEvent(new CustomEvent('flyr:open-feedback'));
        },
      };
    }
    return null;
  }, [activeTab, campaignId, isSelfServeDemo, router, searchParams]);
  const DemoGuideIcon = demoGuideStep?.icon;

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
          showRangeControls={activeTab !== 'reporting' && activeTab !== 'map'}
        />
        {demoGuideStep ? (
          <Card className="mb-4 rounded-2xl border border-border/70 bg-card shadow-sm">
            <CardContent className="space-y-4 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <Badge variant="outline" className="mb-3">
                    {demoGuideStep.eyebrow}
                  </Badge>
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">{demoGuideStep.title}</h2>
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{demoGuideStep.description}</p>
                </div>
                <Button
                  type="button"
                  className="shrink-0 gap-2"
                  onClick={() => void demoGuideStep.action()}
                  data-self-serve-demo-flow="true"
                >
                  {DemoGuideIcon ? <DemoGuideIcon className="h-4 w-4" /> : null}
                  {demoGuideStep.button}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="mb-4 gap-1 bg-transparent p-0">
            <TabsTrigger
              value="summary"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Summary
            </TabsTrigger>
            <TabsTrigger
              value="map"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Live Map
            </TabsTrigger>
            <TabsTrigger
              value="activity"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Activity
            </TabsTrigger>
            <TabsTrigger
              value="reporting"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Reporting
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
              onViewLiveMap={() => handleTabChange('map')}
              onMemberClick={(m) => setSelectedMember({ ...m, color: m.color ?? '#3B82F6' })}
            />
          </TabsContent>
          <TabsContent value="map">
            <TeamMapTab range={range} memberIds={memberIds} mapMode="live" demoLive={showDemoLiveMap} campaignId={campaignId} />
          </TabsContent>
          <TabsContent value="activity">
            <TeamActivityTab range={range} memberIds={memberIds} />
          </TabsContent>
          <TabsContent value="reporting">
            <TeamReportingTab memberIds={memberIds} demoReport={showDemoReport} />
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
