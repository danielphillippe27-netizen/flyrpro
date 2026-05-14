'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Send, Users } from 'lucide-react';
import type { CampaignAddress } from '@/types/database';
import { useWorkspace } from '@/lib/workspace-context';
import {
  distributeWholeTeamGoals,
  type CampaignAssignmentMode,
  type CampaignAssignmentSplitMode,
} from '@/lib/campaignAssignments';
import {
  buildBalancedBlockClusters,
  buildNaturalZoneClusters,
  type BuildRouteAddress,
} from '@/lib/services/BlockRoutingService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type TeamMember = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member';
};

type AssignmentRow = {
  id: string;
  assigned_to_user_id: string;
  mode: CampaignAssignmentMode;
  goal_homes: number;
  zone_index: number | null;
  due_at: string | null;
  notes: string | null;
  assignee?: {
    display_name: string;
  };
  homes?: Array<{ campaign_address_id: string; sequence: number }>;
};

type CampaignAssignmentViewProps = {
  campaignId: string;
  campaignName?: string;
  addresses: CampaignAddress[];
};

type AssignmentAddress = BuildRouteAddress & {
  sequence: number;
};

const COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#8b5cf6', '#d946ef', '#f97316'];

function getAddressCoords(address: CampaignAddress): { lat: number; lon: number } | null {
  const coordinate = address.coordinate;
  if (coordinate && typeof coordinate.lat === 'number' && typeof coordinate.lon === 'number') {
    return { lat: coordinate.lat, lon: coordinate.lon };
  }

  const geomJson = address as CampaignAddress & { geom_json?: { coordinates?: [number, number] } };
  if (geomJson.geom_json?.coordinates) {
    const [lon, lat] = geomJson.geom_json.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }

  if (typeof address.geom === 'string' && address.geom.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(address.geom) as { coordinates?: [number, number] };
      const coordinates = parsed.coordinates;
      if (!coordinates) return null;
      const [lon, lat] = coordinates;
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    } catch {
      return null;
    }
  }

  return null;
}

function toAssignmentAddresses(addresses: CampaignAddress[]): AssignmentAddress[] {
  return addresses
    .map((address, index) => {
      const coords = getAddressCoords(address);
      return {
        id: address.id,
        lat: coords?.lat ?? 0,
        lon: coords?.lon ?? 0,
        house_number: address.house_number,
        street_name: address.street_name,
        formatted: address.formatted ?? address.address,
        sequence: address.sequence ?? address.seq ?? index,
      };
    })
    .sort((left, right) => left.sequence - right.sequence);
}

function contiguousSplit(addresses: AssignmentAddress[], bins: number): AssignmentAddress[][] {
  if (bins <= 1) return [addresses];
  const chunks: AssignmentAddress[][] = [];
  const total = addresses.length;
  let cursor = 0;

  for (let index = 0; index < bins; index += 1) {
    const remainingBins = bins - index;
    const remainingHomes = total - cursor;
    const size = Math.ceil(remainingHomes / remainingBins);
    chunks.push(addresses.slice(cursor, cursor + size));
    cursor += size;
  }

  return chunks;
}

function buildZones(
  addresses: AssignmentAddress[],
  memberIds: string[],
  splitMode: CampaignAssignmentSplitMode
): Map<string, AssignmentAddress[]> {
  const zones = new Map<string, AssignmentAddress[]>();
  if (memberIds.length === 0) return zones;

  if (memberIds.length > addresses.length) {
    memberIds.forEach((memberId) => zones.set(memberId, []));
    return zones;
  }

  const depot = addresses.reduce(
    (sum, address) => ({
      lat: sum.lat + address.lat / addresses.length,
      lon: sum.lon + address.lon / addresses.length,
    }),
    { lat: 0, lon: 0 }
  );
  const clusters =
    splitMode === 'balanced'
      ? buildBalancedBlockClusters(addresses, memberIds.length, depot)
      : buildNaturalZoneClusters(addresses, memberIds.length, depot);
  const chunks =
    clusters.length === memberIds.length
      ? clusters.map((cluster) =>
          cluster.addresses.map((address) => ({
            ...address,
            sequence: addresses.find((candidate) => candidate.id === address.id)?.sequence ?? address.sequence_index,
          }))
        )
      : contiguousSplit(addresses, memberIds.length);

  memberIds.forEach((memberId, index) => {
    zones.set(memberId, chunks[index] ?? []);
  });
  return zones;
}

function formatMode(mode: CampaignAssignmentMode): string {
  return mode === 'zone_split' ? 'Zone split' : 'Whole team';
}

export function CampaignAssignmentView({ campaignId, campaignName, addresses }: CampaignAssignmentViewProps) {
  const { currentWorkspace, membershipsByWorkspaceId } = useWorkspace();
  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canManage = currentRole === 'owner' || currentRole === 'admin';

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [mode, setMode] = useState<CampaignAssignmentMode>('zone_split');
  const [splitMode, setSplitMode] = useState<CampaignAssignmentSplitMode>('natural');
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const assignmentAddresses = useMemo(() => toAssignmentAddresses(addresses), [addresses]);
  const zones = useMemo(
    () => buildZones(assignmentAddresses, selectedMemberIds, splitMode),
    [assignmentAddresses, selectedMemberIds, splitMode]
  );
  const wholeTeamGoals = useMemo(
    () => distributeWholeTeamGoals(addresses.length, selectedMemberIds),
    [addresses.length, selectedMemberIds]
  );

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/assignments`, {
        credentials: 'include',
      });
      const payload = (await response.json().catch(() => null)) as
        | { assignments?: AssignmentRow[]; error?: string }
        | null;
      if (!response.ok) {
        setMessage(payload?.error ?? 'Failed to load assignments.');
        setAssignments([]);
        return;
      }
      setAssignments(Array.isArray(payload?.assignments) ? payload.assignments : []);
    } catch {
      setMessage('Failed to load assignments.');
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  useEffect(() => {
    if (!canManage || !currentWorkspaceId) {
      setMembers([]);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const response = await fetch(`/api/team/roster?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
          credentials: 'include',
        });
        const payload = (await response.json().catch(() => null)) as { members?: TeamMember[] } | null;
        if (!mounted) return;
        const roster = Array.isArray(payload?.members) ? payload.members : [];
        setMembers(roster);
        setSelectedMemberIds((current) => {
          if (current.length > 0) return current.filter((id) => roster.some((member) => member.user_id === id));
          const defaultMembers = roster.filter((member) => member.role !== 'owner').map((member) => member.user_id);
          return defaultMembers.length > 0 ? defaultMembers : roster.map((member) => member.user_id);
        });
      } catch {
        if (!mounted) return;
        setMembers([]);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [canManage, currentWorkspaceId]);

  const selectedMembers = members.filter((member) => selectedMemberIds.includes(member.user_id));

  const handleSave = useCallback(async () => {
    if (!currentWorkspaceId) {
      setMessage('No workspace selected.');
      return;
    }
    if (selectedMemberIds.length === 0) {
      setMessage('Select at least one team member.');
      return;
    }
    if (mode === 'zone_split' && selectedMemberIds.length > assignmentAddresses.length) {
      setMessage('Not enough geocoded homes to give every selected member a zone.');
      return;
    }

    setSaving(true);
    setMessage(null);
    setWarnings([]);

    const zoneAssignments =
      mode === 'zone_split'
        ? selectedMemberIds.map((memberId) => ({
            userId: memberId,
            addressIds: (zones.get(memberId) ?? []).map((address) => address.id),
          }))
        : undefined;

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          mode,
          memberIds: selectedMemberIds,
          dueAt: dueAt ? `${dueAt}T23:59:59` : null,
          notes: notes || null,
          splitMode,
          zoneAssignments,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { assignments?: AssignmentRow[]; warnings?: string[]; error?: string }
        | null;

      if (!response.ok) {
        setMessage(payload?.error ?? 'Failed to assign campaign.');
        return;
      }

      setAssignments(Array.isArray(payload?.assignments) ? payload.assignments : []);
      setWarnings(Array.isArray(payload?.warnings) ? payload.warnings : []);
      setMessage('Campaign assigned.');
      setNotes('');
      setDueAt('');
    } catch {
      setMessage('Failed to assign campaign.');
    } finally {
      setSaving(false);
    }
  }, [
    assignmentAddresses.length,
    campaignId,
    currentWorkspaceId,
    dueAt,
    mode,
    notes,
    selectedMemberIds,
    splitMode,
    zones,
  ]);

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaign Assignment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading assignment...</p> : null}
          {!loading && assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">This campaign has not been assigned to you yet.</p>
          ) : null}
          {assignments.map((assignment) => (
            <div key={assignment.id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{campaignName ?? 'Campaign'}</p>
                  <p className="text-xs text-muted-foreground">{formatMode(assignment.mode)}</p>
                </div>
                <Badge variant="secondary">{assignment.goal_homes} homes</Badge>
              </div>
              {assignment.due_at ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Due {new Date(assignment.due_at).toLocaleDateString()}
                </p>
              ) : null}
              {assignment.notes ? <p className="mt-2 text-xs text-muted-foreground">{assignment.notes}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Assign Campaign
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Assignment mode</Label>
              <div className="inline-flex rounded-lg border border-border bg-muted/20 p-1">
                <button
                  type="button"
                  onClick={() => setMode('zone_split')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'zone_split' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background/80'
                  }`}
                >
                  Zone split
                </button>
                <button
                  type="button"
                  onClick={() => setMode('whole_team')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'whole_team' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background/80'
                  }`}
                >
                  Whole team
                </button>
              </div>
            </div>
            {mode === 'zone_split' ? (
              <div className="space-y-2">
                <Label>Split logic</Label>
                <div className="inline-flex rounded-lg border border-border bg-muted/20 p-1">
                  <button
                    type="button"
                    onClick={() => setSplitMode('natural')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      splitMode === 'natural' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background/80'
                    }`}
                  >
                    Natural zones
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitMode('balanced')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      splitMode === 'balanced' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background/80'
                    }`}
                  >
                    Balanced
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Members</Label>
            <div className="flex flex-wrap gap-2">
              {members.map((member) => {
                const selected = selectedMemberIds.includes(member.user_id);
                return (
                  <Button
                    key={member.user_id}
                    type="button"
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    onClick={() =>
                      setSelectedMemberIds((current) =>
                        current.includes(member.user_id)
                          ? current.filter((id) => id !== member.user_id)
                          : [...current, member.user_id]
                      )
                    }
                    disabled={saving}
                  >
                    {member.display_name}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="campaign-assignment-due">Due date</Label>
              <Input
                id="campaign-assignment-due"
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="mt-1"
                disabled={saving}
              />
            </div>
            <div>
              <Label htmlFor="campaign-assignment-notes">Notes</Label>
              <Input
                id="campaign-assignment-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Instructions for the team"
                className="mt-1"
                disabled={saving}
              />
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {addresses.length} campaign homes ready for assignment.
          </div>

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          {warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              {warnings.slice(0, 3).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <Button className="w-full" onClick={() => void handleSave()} disabled={saving || selectedMemberIds.length === 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Assign Campaign
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {selectedMembers.map((member, index) => {
          const zoneHomes = zones.get(member.user_id) ?? [];
          const goal = mode === 'zone_split' ? zoneHomes.length : wholeTeamGoals.get(member.user_id) ?? 0;
          return (
            <Card key={member.user_id}>
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="truncate text-sm">{member.display_name}</CardTitle>
                  <Badge variant="secondary">{goal} homes</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  {mode === 'zone_split' ? `Zone ${index + 1}` : 'Whole campaign'}
                </div>
                {mode === 'zone_split' ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {zoneHomes
                      .slice(0, 4)
                      .map((address) => address.formatted || address.street_name || address.id.slice(0, 8))
                      .join(', ')}
                    {zoneHomes.length > 4 ? '...' : ''}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">No exclusive zone. The selected team works the campaign together.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {assignments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current Assignments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{assignment.assignee?.display_name ?? assignment.assigned_to_user_id.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">{formatMode(assignment.mode)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{assignment.goal_homes} homes</Badge>
                  <Link href={`/campaigns/${campaignId}`} className="text-xs font-medium text-primary hover:underline">
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
