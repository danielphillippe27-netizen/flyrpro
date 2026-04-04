'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type InviteRole = 'admin' | 'member';

type InviteMemberDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorRole: 'owner' | 'admin';
  seatsRemaining: number;
  isSubmitting: boolean;
  isOpeningBilling?: boolean;
  error: string | null;
  billingError?: string | null;
  isSendingTestInvite?: boolean;
  onSubmit: (payload: {
    emails: string[];
    role: InviteRole;
    additionalSeats: number;
  }) => Promise<void> | void;
  onSendTestInvite?: (options?: { previewEmail?: string }) => Promise<void> | void;
};

export function InviteMemberDialog({
  open,
  onOpenChange,
  actorRole,
  seatsRemaining,
  isSubmitting,
  isOpeningBilling = false,
  error,
  billingError = null,
  isSendingTestInvite = false,
  onSubmit,
  onSendTestInvite,
}: InviteMemberDialogProps) {
  const [emails, setEmails] = useState<string[]>(['']);
  const [role, setRole] = useState<InviteRole>('member');
  const [additionalSeats, setAdditionalSeats] = useState(0);

  useEffect(() => {
    if (!open) {
      setEmails(['']);
      setRole('member');
      setAdditionalSeats(0);
      return;
    }

    if (actorRole === 'admin') {
      setRole('member');
    }
  }, [actorRole, open]);

  const availableMemberSlots = seatsRemaining + additionalSeats;
  const inviteConsumesPaidSeat = role !== 'admin';
  const emailFieldCount = role === 'admin' ? 1 : Math.max(1, availableMemberSlots);
  const trimmedEmails = emails.map((email) => email.trim());
  const filledEmails = trimmedEmails.filter((email) => email.length > 0);
  const canInviteMembers = !inviteConsumesPaidSeat || availableMemberSlots > 0;
  const canSubmit =
    filledEmails.length > 0 &&
    (actorRole === 'owner' || role === 'member') &&
    canInviteMembers &&
    (!inviteConsumesPaidSeat || filledEmails.length <= availableMemberSlots);

  useEffect(() => {
    setEmails((current) => {
      if (current.length === emailFieldCount) return current;
      if (current.length < emailFieldCount) {
        return [...current, ...Array.from({ length: emailFieldCount - current.length }, () => '')];
      }
      return current.slice(0, emailFieldCount);
    });
  }, [emailFieldCount]);

  const busy = isSubmitting || isOpeningBilling || isSendingTestInvite;
  const submitLabel =
    role === 'member' && additionalSeats > 0 && actorRole === 'owner'
      ? busy
        ? 'Updating seats…'
        : `Add ${additionalSeats} seat${additionalSeats === 1 ? '' : 's'} and send invites`
      : busy
        ? 'Sending…'
        : `Send invite${filledEmails.length === 1 ? '' : 's'}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite members</DialogTitle>
          <DialogDescription>
            We&apos;ll send join links to each email address you enter. If delivery is unavailable, the invite still gets created so you can share the link manually.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as InviteRole)}
              disabled={actorRole !== 'owner'}
            >
              <SelectTrigger id="invite-role">
                <SelectValue placeholder="Choose role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                {actorRole === 'owner' ? <SelectItem value="admin">Admin</SelectItem> : null}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {role === 'admin'
                ? 'Admins are free and do not use a paid seat.'
                : 'Members use one paid seat.'}
            </p>
          </div>

          {inviteConsumesPaidSeat ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {seatsRemaining} paid seat{seatsRemaining === 1 ? '' : 's'} remaining
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Add seats here and the invite form will open more email slots automatically.
                  </p>
                </div>
                {actorRole === 'owner' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setAdditionalSeats((value) => Math.max(0, value - 1))}
                      disabled={busy || additionalSeats <= 0}
                    >
                      -
                    </Button>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="h-8 w-20 rounded-md border bg-background px-2 text-sm"
                      value={additionalSeats}
                      onChange={(event) => {
                        const nextValue = Number.parseInt(event.target.value, 10);
                        setAdditionalSeats(Number.isFinite(nextValue) && nextValue >= 0 ? nextValue : 0);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setAdditionalSeats((value) => value + 1)}
                      disabled={busy}
                    >
                      +
                    </Button>
                  </div>
                ) : null}
              </div>

              <p className="text-xs text-muted-foreground">
                {availableMemberSlots > 0
                  ? `You can invite up to ${availableMemberSlots} member${availableMemberSlots === 1 ? '' : 's'} in this batch.`
                  : 'All paid seats are currently allocated.'}
              </p>

              {actorRole !== 'owner' && availableMemberSlots <= 0 ? (
                <p className="text-sm text-muted-foreground">
                  Contact the workspace owner to increase seats.
                </p>
              ) : null}

              {billingError ? <p className="text-sm text-destructive">{billingError}</p> : null}
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Email addresses</Label>
              {role === 'member' ? (
                <span className="text-xs text-muted-foreground">
                  {filledEmails.length}/{availableMemberSlots} filled
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              {emails.map((email, index) => (
                <Input
                  key={index}
                  id={index === 0 ? 'invite-email' : undefined}
                  type="email"
                  autoFocus={index === 0}
                  placeholder={`name${index + 1}@example.com`}
                  value={email}
                  onChange={(event) => {
                    const nextEmails = [...emails];
                    nextEmails[index] = event.target.value;
                    setEmails(nextEmails);
                  }}
                />
              ))}
            </div>

            {inviteConsumesPaidSeat && filledEmails.length > availableMemberSlots ? (
              <p className="text-sm text-destructive">
                Add more paid seats or remove an email before sending these invites.
              </p>
            ) : null}

            {role === 'member' ? (
              <p className="text-xs text-muted-foreground">
                Send test invite emails a <strong className="font-medium text-foreground">sample preview</strong> to the
                first address above (or your login email if empty). It does not create a real invite or use a seat. Check
                spam/junk and that inbox—delivery can take a few minutes.
              </p>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          {role === 'member' ? (
            <Button
              variant="outline"
              onClick={() => {
                const first = filledEmails[0]?.trim();
                onSendTestInvite?.(first ? { previewEmail: first } : {});
              }}
              disabled={busy}
            >
              {isSendingTestInvite ? 'Sending preview…' : 'Send test invite'}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit({ emails: filledEmails, role, additionalSeats })}
            disabled={!canSubmit || busy}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
