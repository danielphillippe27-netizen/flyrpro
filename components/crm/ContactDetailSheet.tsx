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

  useEffect(() => {
    if (open) {
      loadActivities();
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
            <div className="flex gap-2 mt-2">
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

