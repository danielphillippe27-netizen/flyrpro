'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ContactsService } from '@/lib/services/ContactsService';
import type { Contact, ContactActivity } from '@/types/database';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = (fullName || '').trim();
  const space = trimmed.indexOf(' ');
  if (space <= 0) return { firstName: trimmed, lastName: '' };
  return {
    firstName: trimmed.slice(0, space),
    lastName: trimmed.slice(space + 1).trim(),
  };
}

export function ContactDetailSheet({
  contact,
  open,
  onClose,
  onUpdate,
}: {
  contact: Contact;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushResult, setPushResult] = useState<'success' | 'error' | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadActivities();
      setPushResult(null);
      setPushMessage(null);
    }
  }, [open, contact.id]);

  const loadActivities = async () => {
    try {
      const data = await ContactsService.fetchActivities(contact.id);
      setActivities(data);
    } catch (error) {
      console.error('Error loading activities:', error);
    }
  };

  const handleLogActivity = async (type: string, note?: string) => {
    setLoading(true);
    try {
      await ContactsService.logActivity({
        contactId: contact.id,
        type,
        note,
      });
      await loadActivities();
      onUpdate();
    } catch (error) {
      console.error('Error logging activity:', error);
    } finally {
      setLoading(false);
    }
  };

  const canPushToCrm = !!(contact.email || contact.phone);

  const handlePushToCrm = async () => {
    if (!canPushToCrm || pushLoading) return;
    setPushLoading(true);
    setPushResult(null);
    setPushMessage(null);
    try {
      const { firstName, lastName } = splitFullName(contact.full_name);
      const res = await fetch('/api/integrations/followupboss/push-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          email: contact.email || undefined,
          phone: contact.phone || undefined,
          address: contact.address || undefined,
          message: contact.notes
            ? `FLYR lead${contact.campaign_id ? ` (campaign ${contact.campaign_id})` : ''}: ${contact.notes}`
            : `Lead from FLYR${contact.campaign_id ? ` campaign ${contact.campaign_id}` : ''}`,
          source: 'FLYR',
          campaignId: contact.campaign_id || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPushResult('success');
        setPushMessage(data?.message ?? 'Pushed to Follow Up Boss');
      } else {
        setPushResult('error');
        setPushMessage(data?.error ?? 'Failed to push to CRM');
      }
    } catch (err) {
      console.error('Push to CRM error:', err);
      setPushResult('error');
      setPushMessage('Failed to push to CRM');
    } finally {
      setPushLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contact.full_name}</DialogTitle>
          <DialogDescription>Contact Details</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Address</Label>
            <p className="text-sm">{contact.address}</p>
          </div>

          {contact.phone && (
            <div>
              <Label>Phone</Label>
              <p className="text-sm">{contact.phone}</p>
            </div>
          )}

          {contact.email && (
            <div>
              <Label>Email</Label>
              <p className="text-sm">{contact.email}</p>
            </div>
          )}

          {contact.notes && (
            <div>
              <Label>Notes</Label>
              <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
            </div>
          )}

          <div>
            <Label>Tags</Label>
            <Input
              defaultValue={contact.tags ?? ''}
              placeholder="Tag1, Tag2"
              disabled={loading}
              onBlur={async (e) => {
                const value = e.target.value.trim();
                if (value === (contact.tags ?? '')) return;
                setLoading(true);
                try {
                  await ContactsService.updateContact(contact.id, { tags: value || undefined });
                  onUpdate();
                } catch (err) {
                  console.error('Error updating tags:', err);
                } finally {
                  setLoading(false);
                }
              }}
              className="mt-1"
            />
          </div>

          <div>
            <Label>Quick Actions</Label>
            <div className="flex flex-col gap-2 mt-2">
              <Button
                size="default"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handlePushToCrm}
                disabled={pushLoading || !canPushToCrm}
              >
                <Upload className="w-4 h-4 mr-2" />
                {pushLoading ? 'Pushing…' : 'Push to CRM'}
              </Button>
              {!canPushToCrm && (
                <p className="text-xs text-muted-foreground">
                  Add an email or phone number to this lead to push to CRM.
                </p>
              )}
              {pushResult === 'success' && pushMessage && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  {pushMessage}
                </div>
              )}
              {pushResult === 'error' && pushMessage && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {pushMessage}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleLogActivity('call')}
                  disabled={loading}
                >
                  Log Call
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleLogActivity('note')}
                  disabled={loading}
                >
                  Add Note
                </Button>
              </div>
            </div>
          </div>

          <div>
            <Label>Activity History</Label>
            <div className="mt-2 space-y-2">
              {activities.length === 0 ? (
                <p className="text-sm text-gray-500">No activities yet</p>
              ) : (
                activities.map((activity) => (
                  <div key={activity.id} className="text-sm border-l-2 pl-3 py-1">
                    <div className="flex justify-between">
                      <span className="font-medium">{activity.type}</span>
                      <span className="text-gray-500">
                        {new Date(activity.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    {activity.note && <p className="text-gray-600 mt-1">{activity.note}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

