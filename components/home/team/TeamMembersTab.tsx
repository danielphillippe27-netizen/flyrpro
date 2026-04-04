'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MailPlus, RefreshCw, UserMinus, Users } from 'lucide-react';
import type { TeamControlsRange } from '@/components/home/team/TeamControlsBar';
import { InviteMemberDialog } from '@/components/home/team/InviteMemberDialog';

type AnalyticsRow = {
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

type RosterMember = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member';
  color: string;
  joined_at: string;
  is_current_user: boolean;
};

type PendingInvite = {
  id: string;
  email: string;
  role: 'admin' | 'member';
  created_at: string;
  expires_at: string;
  last_sent_at: string | null;
  join_url: string;
};

type InviteMutationResponse = {
  error?: string;
  invite?: PendingInvite;
  emailSent?: boolean;
  emailError?: string | null;
};

type SeatUsage = {
  maxSeats: number;
  activeMembers: number;
  activePaidMembers: number;
  activeAdmins: number;
  pendingInvites: number;
  pendingPaidInvites: number;
  pendingAdminInvites: number;
  seatsUsed: number;
  seatsRemaining: number;
};

type BillingEntitlement = {
  is_active: boolean;
  source: 'none' | 'stripe' | 'apple';
  upgrade_price_id?: string;
};

type RosterResponse = {
  actorRole: 'owner' | 'admin';
  seatUsage: SeatUsage;
  members: RosterMember[];
  pendingInvites: PendingInvite[];
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

type MemberClickPayload = { user_id: string; display_name: string; color: string };

type TeamMembersTabProps = {
  range: TeamControlsRange;
  onMemberClick?: (member: MemberClickPayload) => void;
};

export function TeamMembersTab(props: TeamMembersTabProps) {
  const { range, onMemberClick } = props;
  const { currentWorkspaceId } = useWorkspace();
  const [rosterMembers, setRosterMembers] = useState<RosterMember[]>([]);
  const [analyticsByUserId, setAnalyticsByUserId] = useState<Record<string, AnalyticsRow>>({});
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [seatUsage, setSeatUsage] = useState<SeatUsage | null>(null);
  const [actorRole, setActorRole] = useState<'owner' | 'admin'>('owner');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [openingBilling, setOpeningBilling] = useState(false);
  const [sendingTestInvite, setSendingTestInvite] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!currentWorkspaceId) {
      setRosterMembers([]);
      setPendingInvites([]);
      setSeatUsage(null);
      setError('No workspace selected');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId: currentWorkspaceId,
        start: range.start,
        end: range.end,
      });
      const [rosterRes, analyticsRes] = await Promise.all([
        fetch('/api/team/roster?' + params.toString()),
        fetch('/api/team/members?' + params.toString()),
      ]);
      if (!rosterRes.ok) {
        const payload = (await rosterRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Failed to load team roster');
      }
      if (!analyticsRes.ok) {
        const payload = (await analyticsRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Failed to load member analytics');
      }

      const rosterData = (await rosterRes.json()) as RosterResponse;
      const analyticsData = (await analyticsRes.json()) as { members?: AnalyticsRow[] };

      setActorRole(rosterData.actorRole);
      setSeatUsage(rosterData.seatUsage);
      setRosterMembers(rosterData.members ?? []);
      setPendingInvites(rosterData.pendingInvites ?? []);
      setAnalyticsByUserId(
        Object.fromEntries(((analyticsData.members ?? []) as AnalyticsRow[]).map((row) => [row.user_id, row]))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setRosterMembers([]);
      setPendingInvites([]);
      setSeatUsage(null);
      setAnalyticsByUserId({});
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, range.start, range.end]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const runAction = useCallback(
    async (key: string, work: () => Promise<void>) => {
      setActionKey(key);
      setError(null);
      setNotice(null);
      try {
        await work();
      } finally {
        setActionKey(null);
      }
    },
    []
  );

  const copyInviteLink = useCallback(async (joinUrl: string, noticeMessage = 'Invite link copied.') => {
    if (!navigator?.clipboard?.writeText) {
      throw new Error('Clipboard access is not available in this browser.');
    }
    await navigator.clipboard.writeText(joinUrl);
    setNotice(noticeMessage);
  }, []);

  const handleIncreaseSeats = useCallback(async (
    additionalSeats = 1,
    options?: { showNotice?: boolean }
  ): Promise<'updated' | 'redirected' | 'failed'> => {
    if (actorRole !== 'owner') return 'failed';

    setBillingError(null);
    setOpeningBilling(true);
    try {
      const entitlementRes = await fetch('/api/billing/entitlement', {
        credentials: 'include',
      });
      const entitlement = (await entitlementRes.json().catch(() => null)) as BillingEntitlement | { error?: string } | null;
      if (!entitlementRes.ok) {
        throw new Error(
          (entitlement && 'error' in entitlement && entitlement.error) || 'Failed to load billing details'
        );
      }

      const requestedIncrease = Math.max(1, Math.trunc(additionalSeats));
      const targetSeats = Math.max(1, (seatUsage?.maxSeats ?? 1) + requestedIncrease);
      const openStripeRoute = async (
        endpoint: '/api/billing/stripe/checkout' | '/api/billing/stripe/seats',
        body?: Record<string, unknown>
      ) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body ?? {}),
        });
        const payload = (await response.json().catch(() => null)) as { error?: string; url?: string } | null;
        if (!response.ok || !payload?.url) {
          throw new Error(payload?.error ?? 'Failed to open billing');
        }
        window.location.href = payload.url;
      };

      if ('source' in entitlement && entitlement.source === 'stripe' && entitlement.is_active) {
        const response = await fetch('/api/billing/stripe/seats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ seats: targetSeats }),
        });
        const payload = (await response.json().catch(() => null)) as { error?: string; maxSeats?: number } | null;
        if (!response.ok) {
          throw new Error(payload?.error ?? 'Failed to update paid seats');
        }
        if (options?.showNotice !== false) {
          setNotice(`Paid seats updated to ${payload?.maxSeats ?? targetSeats}. Admins remain free.`);
        }
        await fetchMembers();
        return 'updated';
      }

      if ('source' in entitlement && entitlement.source === 'apple' && entitlement.is_active) {
        throw new Error('Seat changes for Apple billing are not supported here yet.');
      }

      if ('upgrade_price_id' in entitlement && entitlement.upgrade_price_id) {
        await openStripeRoute('/api/billing/stripe/checkout', {
          priceId: entitlement.upgrade_price_id,
          seats: targetSeats,
        });
        return 'redirected';
      }

      window.location.href = `/subscribe?seats=${encodeURIComponent(String(targetSeats))}`;
      return 'redirected';
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to open billing');
      return 'failed';
    } finally {
      setOpeningBilling(false);
    }
  }, [actorRole, fetchMembers, seatUsage?.maxSeats]);

  const handleCreateInvite = useCallback(async ({
    emails,
    role,
    additionalSeats,
  }: {
    emails: string[];
    role: 'admin' | 'member';
    additionalSeats: number;
  }) => {
    if (!currentWorkspaceId) return;
    setInviteError(null);
    setBillingError(null);
    try {
      if (role === 'member' && additionalSeats > 0) {
        const seatUpdateResult = await handleIncreaseSeats(additionalSeats, { showNotice: false });
        if (seatUpdateResult !== 'updated') {
          return;
        }
      }

      await runAction('invite:create', async () => {
        const uniqueEmails: string[] = [];
        const seen = new Set<string>();
        for (const email of emails) {
          const trimmed = email.trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          uniqueEmails.push(trimmed);
        }

        if (uniqueEmails.length === 0) {
          const message = 'Add at least one email before sending invites.';
          setInviteError(message);
          throw new Error(message);
        }

        let createdCount = 0;
        let emailedCount = 0;
        const manualShareLinks: Array<{ email: string; joinUrl: string }> = [];
        const failedInvites: string[] = [];

        for (const email of uniqueEmails) {
          const response = await fetch('/api/team/invites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              workspaceId: currentWorkspaceId,
              email,
              role,
            }),
          });
          const payload = (await response.json().catch(() => null)) as InviteMutationResponse | null;

          if (!response.ok) {
            failedInvites.push(`${email} (${payload?.error ?? 'Failed to create invite'})`);
            continue;
          }

          createdCount += 1;
          if (payload?.emailSent) {
            emailedCount += 1;
          } else if (payload?.invite?.join_url) {
            manualShareLinks.push({ email, joinUrl: payload.invite.join_url });
          }
        }

        await fetchMembers();

        if (manualShareLinks.length === 1 && createdCount === 1) {
          await copyInviteLink(
            manualShareLinks[0].joinUrl,
            `Invite created for ${manualShareLinks[0].email}, but the email was not sent. The link was copied so you can share it manually.`
          );
        } else if (createdCount > 0) {
          const noticeParts = [`${createdCount} invite${createdCount === 1 ? '' : 's'} created`];
          if (emailedCount > 0) {
            noticeParts.push(`${emailedCount} email${emailedCount === 1 ? '' : 's'} sent`);
          }
          if (manualShareLinks.length > 0) {
            noticeParts.push(
              `${manualShareLinks.length} link${manualShareLinks.length === 1 ? '' : 's'} ready to share manually`
            );
          }
          setNotice(noticeParts.join('. ') + '.');
        }

        if (createdCount > 0 && failedInvites.length === 0) {
          setInviteDialogOpen(false);
        }

        if (failedInvites.length > 0) {
          const failureMessage =
            failedInvites.length === 1
              ? failedInvites[0]
              : `${failedInvites.length} invites failed: ${failedInvites.join('; ')}`;
          setInviteError(failureMessage);
          throw new Error(failureMessage);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create invite';
      setInviteError(message);
      setError(message);
    }
  }, [copyInviteLink, currentWorkspaceId, fetchMembers, handleIncreaseSeats, runAction]);

  const handleSendTestInvite = useCallback(async (options?: { previewEmail?: string }) => {
    if (!currentWorkspaceId) return;
    setInviteError(null);
    setBillingError(null);
    setError(null);
    setNotice(null);
    setSendingTestInvite(true);

    try {
      const response = await fetch('/api/team/invites/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          ...(options?.previewEmail ? { previewEmail: options.previewEmail } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        email?: string;
        resendEmailId?: string | null;
        previewUrl?: string;
      } | null;

      if (!response.ok) {
        const message = payload?.error ?? 'Failed to send preview invite';
        setInviteError(message);
        throw new Error(message);
      }

      let clipboardNote = '';
      if (payload?.previewUrl) {
        try {
          await navigator.clipboard.writeText(payload.previewUrl);
          clipboardNote = ' Preview link copied to clipboard.';
        } catch {
          clipboardNote = ` Preview link: ${payload.previewUrl}`;
        }
      }

      const resendNote =
        payload?.resendEmailId?.trim()
          ? ` Resend message id ${payload.resendEmailId} — at https://resend.com/emails confirm whether Resend shows "Delivered".`
          : '';

      setNotice(
        `${payload?.message ?? `Preview invite sent to ${payload?.email ?? 'your email'}.`}${clipboardNote}${resendNote} If the inbox is empty, check Spam and search for subject "Preview:".`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send preview invite';
      setInviteError(message);
      setError(message);
    } finally {
      setSendingTestInvite(false);
    }
  }, [currentWorkspaceId]);

  const handleResendInvite = useCallback(async (inviteId: string) => {
    if (!currentWorkspaceId) return;
    await runAction(`invite:resend:${inviteId}`, async () => {
      const response = await fetch(`/api/team/invites/${inviteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          action: 'resend',
        }),
      });
      const payload = (await response.json().catch(() => null)) as InviteMutationResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to resend invite');
      }

      if (payload?.emailSent) {
        setNotice(`Invite email resent to ${payload?.invite?.email ?? 'the teammate'}.`);
      } else if (payload?.invite?.join_url) {
        await copyInviteLink(
          payload.invite.join_url,
          payload?.emailError?.trim() ||
            'Invite refreshed, but the email was not sent. Link copied so you can send it manually.'
        );
      } else if (payload?.emailError) {
        setNotice(payload.emailError);
      }
      await fetchMembers();
    }).catch((err: Error) => {
      setError(err.message);
    });
  }, [copyInviteLink, currentWorkspaceId, fetchMembers, runAction]);

  const handleCancelInvite = useCallback(async (inviteId: string) => {
    if (!currentWorkspaceId) return;
    await runAction(`invite:cancel:${inviteId}`, async () => {
      const response = await fetch(`/api/team/invites/${inviteId}?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to cancel invite');
      }
      setNotice('Invite canceled.');
      await fetchMembers();
    }).catch((err: Error) => {
      setError(err.message);
    });
  }, [currentWorkspaceId, fetchMembers, runAction]);

  const handleChangeRole = useCallback(async (userId: string, role: 'admin' | 'member') => {
    if (!currentWorkspaceId) return;
    await runAction(`member:role:${userId}`, async () => {
      const response = await fetch(`/api/team/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workspaceId: currentWorkspaceId, role }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to update role');
      }
      setNotice('Member role updated.');
      await fetchMembers();
    }).catch((err: Error) => {
      setError(err.message);
    });
  }, [currentWorkspaceId, fetchMembers, runAction]);

  const handleRemoveMember = useCallback(async (userId: string) => {
    if (!currentWorkspaceId) return;
    await runAction(`member:remove:${userId}`, async () => {
      const response = await fetch(`/api/team/members/${userId}?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to remove member');
      }
      setNotice('Member removed.');
      await fetchMembers();
    }).catch((err: Error) => {
      setError(err.message);
    });
  }, [currentWorkspaceId, fetchMembers, runAction]);

  if (loading && rosterMembers.length === 0 && pendingInvites.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <InviteMemberDialog
        open={inviteDialogOpen}
        onOpenChange={(open) => {
          setInviteDialogOpen(open);
          if (!open) {
            setInviteError(null);
            setBillingError(null);
          }
        }}
        actorRole={actorRole}
        seatsRemaining={seatUsage?.seatsRemaining ?? 0}
        isSubmitting={actionKey === 'invite:create'}
        isOpeningBilling={openingBilling}
        isSendingTestInvite={sendingTestInvite}
        error={inviteError}
        billingError={billingError}
        onSubmit={handleCreateInvite}
        onSendTestInvite={handleSendTestInvite}
      />

      {error ? (
        <Card className="border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}
      {notice ? (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">{notice}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            Active Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rosterMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members in this workspace.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rosterMembers.map((member) => {
                  const analytics = analyticsByUserId[member.user_id];
                  const isActive =
                    (analytics?.sessions_count ?? 0) > 0 ||
                    (analytics?.inactive_days !== null &&
                      analytics?.inactive_days !== undefined &&
                      analytics.inactive_days < 7);
                  const canPromoteDemote =
                    actorRole === 'owner' &&
                    !member.is_current_user &&
                    member.role !== 'owner';
                  const canRemove =
                    !member.is_current_user &&
                    member.role !== 'owner' &&
                    (actorRole === 'owner' || member.role === 'member');

                  return (
                    <TableRow
                      key={member.user_id}
                      className={onMemberClick ? 'cursor-pointer' : undefined}
                      onClick={
                        onMemberClick
                          ? () =>
                              onMemberClick({
                                user_id: member.user_id,
                                display_name: member.display_name,
                                color: member.color,
                              })
                          : undefined
                      }
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: member.color }}
                            aria-hidden
                          />
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{member.display_name}</span>
                            {member.is_current_user ? <Badge variant="outline">You</Badge> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{member.role}</TableCell>
                      <TableCell>{formatDate(member.joined_at)}</TableCell>
                      <TableCell>{formatLastActive(analytics?.last_active_at ?? null)}</TableCell>
                      <TableCell className="text-right">{analytics?.sessions_count ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant={isActive ? 'secondary' : 'outline'}>
                          {isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                          {canPromoteDemote ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={actionKey === `member:role:${member.user_id}`}
                              onClick={() =>
                                handleChangeRole(
                                  member.user_id,
                                  member.role === 'admin' ? 'member' : 'admin'
                                )
                              }
                            >
                              {member.role === 'admin' ? 'Make member' : 'Make admin'}
                            </Button>
                          ) : null}
                          {canRemove ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={actionKey === `member:remove:${member.user_id}`}
                              onClick={() => handleRemoveMember(member.user_id)}
                            >
                              <UserMinus className="mr-2 h-4 w-4" />
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Seats</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              You pay for member seats. Admins are free.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setInviteDialogOpen(true)}
            disabled={!seatUsage}
          >
            <MailPlus className="mr-2 h-4 w-4" />
            Invite member
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {seatUsage?.seatsUsed ?? 0} paid used
            </Badge>
            <Badge variant="outline">
              {seatUsage?.maxSeats ?? 0} paid seats
            </Badge>
            <Badge variant="outline">
              {seatUsage?.seatsRemaining ?? 0} paid remaining
            </Badge>
            <Badge variant="outline">
              {seatUsage?.activeAdmins ?? 0} admins free
            </Badge>
            <Badge variant="outline">
              {seatUsage?.pendingAdminInvites ?? 0} admin invites
            </Badge>
            <Badge variant="outline">
              {seatUsage?.activeMembers ?? 0} active people
            </Badge>
            <Badge variant="outline">
              {seatUsage?.pendingInvites ?? 0} pending invites
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Pending Invites
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingInvites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((invite) => {
                  const canManageInvite =
                    actorRole === 'owner' || invite.role === 'member';
                  return (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell className="capitalize">{invite.role}</TableCell>
                      <TableCell>{formatDate(invite.last_sent_at ?? invite.created_at)}</TableCell>
                      <TableCell>{formatDate(invite.expires_at)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void copyInviteLink(invite.join_url).catch((err) => {
                                setError(err instanceof Error ? err.message : 'Failed to copy invite link');
                              });
                            }}
                          >
                            Copy link
                          </Button>
                          {canManageInvite ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={actionKey === `invite:resend:${invite.id}`}
                              onClick={() => handleResendInvite(invite.id)}
                            >
                              Resend
                            </Button>
                          ) : null}
                          {canManageInvite ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={actionKey === `invite:cancel:${invite.id}`}
                              onClick={() => handleCancelInvite(invite.id)}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
