'use client';

import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
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
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (payload: { emails: string[]; role: InviteRole }) => Promise<void> | void;
};

export function InviteMemberDialog({
  open,
  onOpenChange,
  actorRole,
  isSubmitting,
  error,
  onSubmit,
}: InviteMemberDialogProps) {
  const [emails, setEmails] = useState<string[]>(['']);
  const [role, setRole] = useState<InviteRole>('member');

  useEffect(() => {
    if (!open) {
      setEmails(['']);
      setRole('member');
    } else if (actorRole === 'admin') {
      setRole('member');
    }
  }, [actorRole, open]);

  const filledEmails = emails.map((email) => email.trim()).filter(Boolean);
  const canSubmit =
    filledEmails.length > 0 &&
    (actorRole === 'owner' || role === 'member') &&
    !isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-self-serve-demo-allow="true">
        <DialogHeader>
          <DialogTitle>Invite teammates</DialogTitle>
          <DialogDescription>
            Teammates are included with your workspace. We&apos;ll email a join link to each address; if delivery is unavailable, you can share the generated link manually.
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
                ? 'Admins can manage teammates and workspace settings.'
                : 'Members can collaborate on the workspace campaign.'}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Email addresses</Label>
              <span className="text-xs text-muted-foreground">{filledEmails.length} ready</span>
            </div>
            <div className="space-y-2">
              {emails.map((email, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    id={index === 0 ? 'invite-email' : undefined}
                    type="email"
                    autoFocus={index === 0}
                    placeholder={`name${index + 1}@example.com`}
                    value={email}
                    onChange={(event) => {
                      setEmails((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item
                        )
                      );
                    }}
                  />
                  {emails.length > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Remove email ${index + 1}`}
                      onClick={() => setEmails((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      disabled={isSubmitting}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEmails((current) => [...current, ''])}
              disabled={isSubmitting}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add another email
            </Button>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit({ emails: filledEmails, role })} disabled={!canSubmit}>
            {isSubmitting ? 'Sending invites…' : 'Send invites'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
