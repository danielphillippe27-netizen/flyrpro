'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Goal, Pencil } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import type { TeamControlsRange } from '@/components/home/team/TeamControlsBar';
import { TeamMembersTab } from '@/components/home/team/TeamMembersTab';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

type TeamGoalsResponse = {
  weekly_door_goal: number;
  weekly_sessions_goal: number | null;
  source: 'workspace' | 'member_aggregate';
  members: Array<{
    user_id: string;
    display_name: string;
    role: 'owner' | 'admin' | 'member';
    color: string;
    weekly_door_goal: number;
  }>;
};

type MemberClickPayload = {
  user_id: string;
  display_name: string;
  color: string;
};

type TeamSettingsTabProps = {
  range: TeamControlsRange;
  onMemberClick?: (member: MemberClickPayload) => void;
};

export function TeamSettingsTab({ range, onMemberClick }: TeamSettingsTabProps) {
  const { currentWorkspaceId } = useWorkspace();
  const [goals, setGoals] = useState<TeamGoalsResponse | null>(null);
  const [memberDoorGoals, setMemberDoorGoals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const teamMembers = useMemo(() => goals?.members ?? [], [goals?.members]);
  const computedDoorGoal = useMemo(
    () =>
      teamMembers.reduce((sum, member) => {
        const localValue = memberDoorGoals[member.user_id];
        const parsedValue =
          localValue == null ? member.weekly_door_goal : Math.max(0, Number.parseInt(localValue, 10) || 0);
        return sum + parsedValue;
      }, 0),
    [memberDoorGoals, teamMembers]
  );

  const loadGoals = useCallback(async () => {
    if (!currentWorkspaceId) {
      setGoals(null);
      setMemberDoorGoals({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspaceId: currentWorkspaceId });
      const response = await fetch(`/api/team/goals?${params.toString()}`, {
        credentials: 'include',
      });
      const payload = (await response.json().catch(() => null)) as
        | TeamGoalsResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          payload && 'error' in payload && payload.error ? payload.error : 'Failed to load team goals'
        );
      }

      const nextGoals = payload as TeamGoalsResponse;
      setGoals(nextGoals);
      setMemberDoorGoals(
        Object.fromEntries(nextGoals.members.map((member) => [member.user_id, String(member.weekly_door_goal)]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team goals');
      setGoals(null);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  const handleSaveGoals = useCallback(async () => {
    if (!currentWorkspaceId) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/team/goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          member_goals: teamMembers.map((member) => ({
            user_id: member.user_id,
            weekly_door_goal: Math.max(
              0,
              Number.parseInt(memberDoorGoals[member.user_id] ?? String(member.weekly_door_goal), 10) || 0
            ),
          })),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | TeamGoalsResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          payload && 'error' in payload && payload.error ? payload.error : 'Failed to save team goals'
        );
      }

      const savedGoals = payload as TeamGoalsResponse;
      setGoals(savedGoals);
      setMemberDoorGoals(
        Object.fromEntries(savedGoals.members.map((member) => [member.user_id, String(member.weekly_door_goal)]))
      );
      setNotice('Team goals saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save team goals');
    } finally {
      setSaving(false);
    }
  }, [currentWorkspaceId, memberDoorGoals, teamMembers]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <Goal className="h-7 w-7 shrink-0 sm:h-8 sm:w-8" />
                <CardTitle className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Team Goals
                </CardTitle>
              </div>
              <CardDescription>
                Team door goals roll up from each member&apos;s required weekly target.
              </CardDescription>
            </div>
            {!loading && goals ? (
              <Badge variant={goals.source === 'workspace' ? 'secondary' : 'outline'}>
                {goals.source === 'workspace' ? 'Saved team goal' : 'Inherited from member goals'}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-28 w-full max-w-[520px]" />
            </div>
          ) : (
            <>
              {error ? (
                <div className="rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
              {notice ? (
                <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                  {notice}
                </div>
              ) : null}

              <div className="flex w-full max-w-[460px] items-center gap-0.5">
                <Label htmlFor="team-goals-doors" className="text-base font-medium sm:text-lg">
                  Doors per week
                </Label>
                <Input
                  id="team-goals-doors"
                  type="number"
                  min={0}
                  value={String(computedDoorGoal)}
                  readOnly
                  className="h-16 w-[170px] border-dashed bg-muted/40 px-2 text-center text-5xl font-semibold tabular-nums leading-none text-foreground shadow-none sm:h-20 sm:w-[220px] sm:text-6xl"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                {teamMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground sm:col-span-2">No team members yet.</p>
                ) : (
                  teamMembers.map((member) => (
                    <div
                      key={member.user_id}
                      className="grid gap-2.5 rounded-xl border border-border/80 bg-background/60 p-3.5 shadow-sm transition-colors hover:border-primary/40 sm:p-4"
                    >
                      <Label className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: member.color }}
                            aria-hidden
                          />
                          <span className="truncate">{member.display_name}</span>
                        </span>
                        <Badge variant="outline" className="capitalize text-[10px]">
                          {member.role}
                        </Badge>
                      </Label>
                      <div className="relative max-w-[180px]">
                        <Input
                          type="number"
                          min={0}
                          value={memberDoorGoals[member.user_id] ?? String(member.weekly_door_goal)}
                          onChange={(event) =>
                            setMemberDoorGoals((current) => ({
                              ...current,
                              [member.user_id]: event.target.value,
                            }))
                          }
                          className="h-10 max-w-full cursor-text border-primary/30 bg-background pr-9 text-base font-semibold shadow-sm transition-colors hover:border-primary/50 focus-visible:border-primary focus-visible:ring-primary/20"
                        />
                        <Pencil
                          className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-primary/70"
                          aria-hidden
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">Required weekly door goal</p>
                    </div>
                  ))
                )}
              </div>

              {goals?.source === 'member_aggregate' ? (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  The team door goal is the sum of the individual weekly targets below.
                </div>
              ) : null}

              <Button onClick={handleSaveGoals} disabled={saving || !currentWorkspaceId} size="sm">
                {saving ? 'Saving...' : 'Save team goals'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      <TeamMembersTab range={range} onMemberClick={onMemberClick} />
    </div>
  );
}
