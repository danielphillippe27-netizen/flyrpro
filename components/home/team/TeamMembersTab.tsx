'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeamControlsRange } from '@/components/home/team/TeamControlsBar';

type MemberRow = {
  user_id: string;
  display_name: string;
  role?: string;
  color: string;
  last_active_at: string | null;
  inactive_days: number | null;
  doors_knocked: number;
  conversations: number;
  sessions_count: number;
  active_days: number;
};

function formatLastActive(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Today';
  if (days === 1) return '1d ago';
  if (days < 7) return days + 'd ago';
  if (days < 30) return Math.floor(days / 7) + 'w ago';
  return Math.floor(days / 30) + 'mo ago';
}

type MemberClickPayload = { user_id: string; display_name: string; color: string };

type TeamMembersTabProps = {
  range: TeamControlsRange;
  onMemberClick?: (member: MemberClickPayload) => void;
};

export function TeamMembersTab(props: TeamMembersTabProps) {
  const { range, onMemberClick } = props;
  const { currentWorkspaceId } = useWorkspace();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId: currentWorkspaceId,
        start: range.start,
        end: range.end,
      });
      const res = await fetch('/api/team/members?' + params.toString());
      if (!res.ok) throw new Error('Failed to load members');
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, range.start, range.end]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  if (loading && members.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Card className="border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members in this workspace.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium">Member</th>
                    <th className="text-left py-2 font-medium">Role</th>
                    <th className="text-left py-2 font-medium">Last active</th>
                    <th className="text-right py-2 font-medium">Doors</th>
                    <th className="text-right py-2 font-medium">Convos</th>
                    <th className="text-right py-2 font-medium">Sessions</th>
                    <th className="text-left py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(function (r) {
                    const isActive = r.sessions_count > 0 || (r.inactive_days !== null && r.inactive_days < 7);
                    const rowClass = cn(
                      'border-b border-border/50',
                      onMemberClick ? 'cursor-pointer hover:bg-muted/50' : ''
                    );
                    const statusClass = isActive
                      ? 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
                    return (
                      <tr
                        key={r.user_id}
                        className={rowClass}
                        onClick={onMemberClick ? () => onMemberClick({ user_id: r.user_id, display_name: r.display_name, color: r.color }) : undefined}
                        role={onMemberClick ? 'button' : undefined}
                      >
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="shrink-0 w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: r.color }}
                              aria-hidden
                            />
                            <span className="font-medium">{r.display_name}</span>
                          </div>
                        </td>
                        <td className="py-2 text-muted-foreground capitalize">{r.role ?? '—'}</td>
                        <td className="py-2 text-muted-foreground">{formatLastActive(r.last_active_at)}</td>
                        <td className="text-right py-2">{r.doors_knocked}</td>
                        <td className="text-right py-2">{r.conversations}</td>
                        <td className="text-right py-2">{r.sessions_count}</td>
                        <td className="py-2">
                          <span className={statusClass}>
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
