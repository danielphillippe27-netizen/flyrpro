'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/lib/workspace-context';

type AssignmentStatus =
  | 'assigned'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'cancelled';

type AssignmentRow = {
  id: string;
  status: AssignmentStatus;
  priority?: 'low' | 'normal' | 'high';
  due_at?: string | null;
  notes?: string | null;
  decline_reason?: string | null;
  updated_at: string;
  route_plan: {
    id: string;
    name: string;
    total_stops: number;
    est_minutes: number | null;
  } | null;
};

type AssignmentStop = {
  id: string;
  stop_order: number;
  display_address: string | null;
};

type AssignmentRouteDetail = {
  assignment: {
    id: string;
  };
  route_plan: {
    id: string;
    name: string;
    total_stops: number;
    est_minutes: number | null;
  };
  stops: AssignmentStop[];
};

function statusLabel(status: AssignmentStatus): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'assigned') return 'Assigned';
  if (status === 'accepted') return 'Accepted';
  if (status === 'completed') return 'Completed';
  if (status === 'declined') return 'Declined';
  return 'Cancelled';
}

function statusVariant(status: AssignmentStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'completed') return 'secondary';
  if (status === 'declined') return 'destructive';
  if (status === 'cancelled') return 'outline';
  if (status === 'in_progress') return 'default';
  return 'outline';
}

export function MyRouteAssignmentsCard() {
  const { currentWorkspaceId } = useWorkspace();
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openAssignmentId, setOpenAssignmentId] = useState<string | null>(null);
  const [loadingRouteId, setLoadingRouteId] = useState<string | null>(null);
  const [routeDetailsByAssignmentId, setRouteDetailsByAssignmentId] = useState<
    Record<string, AssignmentRouteDetail>
  >({});

  const loadAssignments = useCallback(async () => {
    if (!currentWorkspaceId) {
      setAssignments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/routes/assignments?workspaceId=${encodeURIComponent(currentWorkspaceId)}`,
        { credentials: 'include' }
      );
      const payload = (await response.json().catch(() => null)) as
        | { assignments?: AssignmentRow[]; error?: string }
        | null;
      if (!response.ok) {
        setMessage(payload?.error ?? 'Failed to load route assignments.');
        setAssignments([]);
        return;
      }
      setAssignments(Array.isArray(payload?.assignments) ? payload.assignments : []);
    } catch {
      setMessage('Failed to load route assignments.');
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const handleAction = useCallback(
    async (assignmentId: string, action: 'accept' | 'decline' | 'start' | 'complete') => {
      setBusyId(assignmentId);
      setMessage(null);
      try {
        const declineReason =
          action === 'decline'
            ? window.prompt('Optional reason for declining this route:', '') ?? ''
            : '';
        const response = await fetch('/api/routes/assignments/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            assignmentId,
            action,
            declineReason: declineReason.trim() || undefined,
          }),
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          setMessage(payload?.error ?? 'Failed to update route assignment.');
          return;
        }
        await loadAssignments();
      } catch {
        setMessage('Failed to update route assignment.');
      } finally {
        setBusyId(null);
      }
    },
    [loadAssignments]
  );

  const activeAssignments = useMemo(
    () =>
      assignments.filter(
        (entry) => entry.status === 'assigned' || entry.status === 'accepted' || entry.status === 'in_progress'
      ),
    [assignments]
  );

  const recentHistory = useMemo(
    () => assignments.filter((entry) => entry.status === 'completed' || entry.status === 'declined').slice(0, 3),
    [assignments]
  );

  const handleOpenRoute = useCallback(async (assignmentId: string) => {
    if (openAssignmentId === assignmentId) {
      setOpenAssignmentId(null);
      return;
    }

    if (routeDetailsByAssignmentId[assignmentId]) {
      setOpenAssignmentId(assignmentId);
      return;
    }

    setLoadingRouteId(assignmentId);
    setMessage(null);
    try {
      const response = await fetch(`/api/routes/assignments/${assignmentId}`, {
        credentials: 'include',
      });
      const payload = (await response.json().catch(() => null)) as
        | AssignmentRouteDetail
        | { error?: string }
        | null;
      if (!response.ok || !payload || !('route_plan' in payload)) {
        const errorMessage =
          payload && 'error' in payload && payload.error ? payload.error : 'Failed to load route details.';
        setMessage(errorMessage);
        return;
      }
      setRouteDetailsByAssignmentId((current) => ({
        ...current,
        [assignmentId]: payload,
      }));
      setOpenAssignmentId(assignmentId);
    } catch {
      setMessage('Failed to load route details.');
    } finally {
      setLoadingRouteId(null);
    }
  }, [openAssignmentId, routeDetailsByAssignmentId]);

  return (
    <Card className="rounded-xl border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">My Route Assignments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <p className="text-sm text-muted-foreground">Loading assignments...</p> : null}

        {!loading && activeAssignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active route assignments.</p>
        ) : null}

        {activeAssignments.map((assignment) => (
          <div
            key={assignment.id}
            className="rounded-lg border border-border bg-background px-3 py-3 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {assignment.route_plan?.name ?? 'Route plan'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(assignment.route_plan?.total_stops ?? 0).toLocaleString()} stops
                  {assignment.route_plan?.est_minutes ? ` • ~${assignment.route_plan.est_minutes} min` : ''}
                  {assignment.due_at ? ` • due ${new Date(assignment.due_at).toLocaleString()}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {assignment.priority ? (
                  <Badge variant="outline">{assignment.priority}</Badge>
                ) : null}
                <Badge variant={statusVariant(assignment.status)}>{statusLabel(assignment.status)}</Badge>
              </div>
            </div>
            {assignment.notes ? (
              <p className="text-xs text-muted-foreground">Lead note: {assignment.notes}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleOpenRoute(assignment.id)}
                disabled={loadingRouteId === assignment.id}
              >
                {loadingRouteId === assignment.id
                  ? 'Opening...'
                  : openAssignmentId === assignment.id
                    ? 'Hide route'
                    : 'Open route'}
              </Button>
              {assignment.status === 'assigned' ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => void handleAction(assignment.id, 'accept')}
                    disabled={busyId === assignment.id}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleAction(assignment.id, 'decline')}
                    disabled={busyId === assignment.id}
                  >
                    Decline
                  </Button>
                </>
              ) : null}
              {assignment.status === 'accepted' ? (
                <Button
                  size="sm"
                  onClick={() => void handleAction(assignment.id, 'start')}
                  disabled={busyId === assignment.id}
                >
                  Start route
                </Button>
              ) : null}
              {assignment.status === 'in_progress' ? (
                <Button
                  size="sm"
                  onClick={() => void handleAction(assignment.id, 'complete')}
                  disabled={busyId === assignment.id}
                >
                  Complete route
                </Button>
              ) : null}
            </div>
            {openAssignmentId === assignment.id ? (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 max-h-64 overflow-y-auto">
                <p className="text-xs font-medium text-muted-foreground mb-2">Homes in this route</p>
                {(routeDetailsByAssignmentId[assignment.id]?.stops ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No homes found for this route yet.</p>
                ) : (
                  <div className="space-y-1">
                    {(routeDetailsByAssignmentId[assignment.id]?.stops ?? []).map((stop) => (
                      <p key={stop.id} className="text-xs text-foreground">
                        {stop.stop_order}. {stop.display_address || 'Unknown address'}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ))}

        {!loading && recentHistory.length > 0 ? (
          <div className="pt-1">
            <p className="text-xs font-medium text-muted-foreground mb-2">Recent history</p>
            <div className="space-y-2">
              {recentHistory.map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate mr-3">{assignment.route_plan?.name ?? 'Route plan'}</span>
                  <span>{statusLabel(assignment.status)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {message ? <p className="text-sm text-destructive">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
