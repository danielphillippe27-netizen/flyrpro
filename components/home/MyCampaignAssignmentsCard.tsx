'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import type { CampaignAssignmentMode } from '@/lib/campaignAssignments';

type AssignmentRow = {
  id: string;
  campaign_id: string;
  mode: CampaignAssignmentMode;
  goal_homes: number;
  due_at: string | null;
  notes: string | null;
  campaign: {
    name: string | null;
    status: string | null;
  } | null;
};

function modeLabel(mode: CampaignAssignmentMode): string {
  return mode === 'zone_split' ? 'Zone' : 'Whole team';
}

const fetchedWorkspaceIds = new Set<string>();

export function MyCampaignAssignmentsCard() {
  const { currentWorkspaceId } = useWorkspace();
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadAssignments = useCallback(async () => {
    if (!currentWorkspaceId) {
      setAssignments([]);
      setLoading(false);
      return;
    }
    if (fetchedWorkspaceIds.has(currentWorkspaceId)) return;

    setLoading(true);
    try {
      const response = await fetch(
        `/api/campaign-assignments?workspaceId=${encodeURIComponent(currentWorkspaceId)}`,
        { credentials: 'include' }
      );
      const payload = (await response.json().catch(() => null)) as
        | { assignments?: AssignmentRow[]; error?: string }
        | null;
      if (!response.ok) {
        setMessage(payload?.error ?? 'Failed to load campaign assignments.');
        setAssignments([]);
        return;
      }
      fetchedWorkspaceIds.add(currentWorkspaceId);
      setAssignments(Array.isArray(payload?.assignments) ? payload.assignments : []);
    } catch {
      setMessage('Failed to load campaign assignments.');
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  return (
    <Card className="rounded-xl border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4" />
          My Campaign Assignments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <p className="text-sm text-muted-foreground">Loading assignments...</p> : null}
        {!loading && assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active campaign assignments.</p>
        ) : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {assignments.map((assignment) => (
          <div key={assignment.id} className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {assignment.campaign?.name ?? 'Campaign'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {modeLabel(assignment.mode)}
                  {assignment.due_at ? ` • due ${new Date(assignment.due_at).toLocaleDateString()}` : ''}
                </p>
              </div>
              <Badge variant="secondary">{assignment.goal_homes} homes</Badge>
            </div>
            {assignment.notes ? <p className="mt-2 text-xs text-muted-foreground">{assignment.notes}</p> : null}
            <Button asChild size="sm" className="mt-3">
              <Link href={`/campaigns/${assignment.campaign_id}`}>Open campaign</Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
