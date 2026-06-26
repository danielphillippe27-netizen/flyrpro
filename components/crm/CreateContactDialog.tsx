'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ContactsService } from '@/lib/services/ContactsService';
import { getIndustryCopy, type IndustryCopy } from '@/lib/industry-copy';
import type { ContactStatus } from '@/types/database';

type ContactFormData = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
};

const emptyContactFormData = (): ContactFormData => ({
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
});

interface CreateContactDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId: string;
  workspaceId?: string;
  portalContainer?: HTMLElement | null;
  initialAddress?: string;
  initialAddressId?: string;
  initialCampaignId?: string;
  initialFarmId?: string;
  initialNotes?: string;
  copy?: IndustryCopy;
}

export function CreateContactDialog({
  open,
  onClose,
  onSuccess,
  userId,
  workspaceId,
  portalContainer,
  initialAddress,
  initialAddressId,
  initialCampaignId,
  initialFarmId,
  initialNotes,
  copy: industryCopy,
}: CreateContactDialogProps) {
  const copy = industryCopy ?? getIndustryCopy(null);
  const [loading, setLoading] = useState(false);
  const [primaryContact, setPrimaryContact] = useState<ContactFormData>(emptyContactFormData);
  const [showSecondContact, setShowSecondContact] = useState(false);
  const [secondContact, setSecondContact] = useState<ContactFormData>(emptyContactFormData);
  const [formData, setFormData] = useState({
    address: initialAddress || '',
    status: 'new' as ContactStatus,
    source: '',
    tags: '',
    last_contacted: '',
    notes: initialNotes || '',
    follow_up_at: '',
    appointment_at: '',
  });

  const toIsoString = (value: string): string | undefined => {
    if (!value.trim()) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };

  // Update form data when initial values change
  useEffect(() => {
    if (initialAddress) {
      setFormData(prev => ({ ...prev, address: initialAddress }));
    }
  }, [initialAddress]);

  useEffect(() => {
    setFormData(prev => ({ ...prev, notes: initialNotes || '' }));
  }, [initialNotes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!primaryContact.first_name.trim()) {
      alert('Please fill in the required field: First Name');
      return;
    }
    if (showSecondContact && !secondContact.first_name.trim()) {
      alert('Please fill in the required field: 2nd Contact First Name');
      return;
    }

    setLoading(true);
    try {
      const contactsToCreate = [
        primaryContact,
        ...(showSecondContact ? [secondContact] : []),
      ];

      let lastCrmSync: Array<{ provider: string; displayName: string; status: string; ms?: number }> = [];

      for (const contact of contactsToCreate) {
        const payload = {
          first_name: contact.first_name.trim(),
          last_name: contact.last_name.trim() || undefined,
          phone: contact.phone.trim() || undefined,
          email: contact.email.trim() || undefined,
          address: formData.address.trim() || undefined,
          campaign_id: initialCampaignId,
          farm_id: initialFarmId,
          status: formData.status,
          source: formData.source.trim() || undefined,
          tags: formData.tags.trim() || undefined,
          last_contacted: toIsoString(formData.last_contacted),
          notes: formData.notes.trim() || undefined,
          follow_up_at: toIsoString(formData.follow_up_at),
          appointment_at: toIsoString(formData.appointment_at),
        };

        let result;
        if (initialAddressId) {
          result = await ContactsService.createContactWithAddress(
            userId,
            { ...payload, address_id: initialAddressId },
            workspaceId
          );
        } else {
          result = await ContactsService.createContact(userId, payload, workspaceId);
        }
        if (result?.crmSync) lastCrmSync = result.crmSync;
      }

      // Show CRM sync confirmation toast
      const synced = lastCrmSync.filter((r) => r.status === 'synced');
      if (synced.length > 0) {
        const label = synced.length === 1
          ? `Synced → ${synced[0].displayName}${synced[0].ms != null ? ` · ${(synced[0].ms / 1000).toFixed(1)}s` : ''}`
          : `Synced → ${synced.map((r) => r.displayName).join(', ')}`;
        toast.success(`✓ ${label}`);
      }

      // Reset form
      setPrimaryContact(emptyContactFormData());
      setSecondContact(emptyContactFormData());
      setShowSecondContact(false);
      setFormData({
        address: '',
        status: 'new',
        source: '',
        tags: '',
        last_contacted: '',
        notes: '',
        follow_up_at: '',
        appointment_at: '',
      });

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error creating contact:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to create contact: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setPrimaryContact(emptyContactFormData());
      setSecondContact(emptyContactFormData());
      setShowSecondContact(false);
      setFormData({
        address: '',
        status: 'new',
        source: '',
        tags: '',
        last_contacted: '',
        notes: '',
        follow_up_at: '',
        appointment_at: '',
      });
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto"
        portalContainer={portalContainer}
      >
        <DialogHeader>
          <DialogTitle>{copy.contactDialog.title}</DialogTitle>
          <DialogDescription>{copy.contactDialog.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="first_name">
                  First Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="first_name"
                  value={primaryContact.first_name}
                  onChange={(e) => setPrimaryContact({ ...primaryContact, first_name: e.target.value })}
                  placeholder="John"
                  required
                  disabled={loading}
                />
              </div>
              <div>
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  value={primaryContact.last_name}
                  onChange={(e) => setPrimaryContact({ ...primaryContact, last_name: e.target.value })}
                  placeholder="Doe"
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={primaryContact.phone}
                onChange={(e) => setPrimaryContact({ ...primaryContact, phone: e.target.value })}
                placeholder="(555) 123-4567"
                disabled={loading}
              />
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={primaryContact.email}
                onChange={(e) => setPrimaryContact({ ...primaryContact, email: e.target.value })}
                placeholder="john@example.com"
                disabled={loading}
              />
            </div>

            <div className="flex justify-start">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (showSecondContact) {
                    setSecondContact(emptyContactFormData());
                  }
                  setShowSecondContact((value) => !value);
                }}
                disabled={loading}
              >
                {showSecondContact ? copy.contactDialog.removeSecondContact : copy.contactDialog.addSecondContact}
              </Button>
            </div>

            {showSecondContact && (
              <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-zinc-800">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{copy.contactDialog.secondContact}</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="second_first_name">
                      First Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="second_first_name"
                      value={secondContact.first_name}
                      onChange={(e) => setSecondContact({ ...secondContact, first_name: e.target.value })}
                      placeholder="Jane"
                      disabled={loading}
                    />
                  </div>
                  <div>
                    <Label htmlFor="second_last_name">Last Name</Label>
                    <Input
                      id="second_last_name"
                      value={secondContact.last_name}
                      onChange={(e) => setSecondContact({ ...secondContact, last_name: e.target.value })}
                      placeholder="Doe"
                      disabled={loading}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="second_phone">Phone</Label>
                  <Input
                    id="second_phone"
                    type="tel"
                    value={secondContact.phone}
                    onChange={(e) => setSecondContact({ ...secondContact, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                    disabled={loading}
                  />
                </div>

                <div>
                  <Label htmlFor="second_email">Email</Label>
                  <Input
                    id="second_email"
                    type="email"
                    value={secondContact.email}
                    onChange={(e) => setSecondContact({ ...secondContact, email: e.target.value })}
                    placeholder="jane@example.com"
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="123 Main St, City, State ZIP"
              disabled={loading}
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="status">
              Status <span className="text-red-500">*</span>
            </Label>
            <Select
              value={formData.status}
              onValueChange={(value) => setFormData({ ...formData, status: value as ContactStatus })}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="hot">Hot</SelectItem>
                <SelectItem value="warm">Warm</SelectItem>
                <SelectItem value="cold">Cold</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="source">Source</Label>
              <Input
                id="source"
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                placeholder={copy.contactDialog.sourcePlaceholder}
                disabled={loading}
              />
            </div>
            <div>
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder={copy.contactDialog.tagsPlaceholder}
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder={copy.contactDialog.notesPlaceholder}
              disabled={loading}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="last_contacted">Last Contacted</Label>
              <Input
                id="last_contacted"
                type="datetime-local"
                value={formData.last_contacted}
                onChange={(e) => setFormData({ ...formData, last_contacted: e.target.value })}
                disabled={loading}
              />
            </div>
            <div>
              <Label htmlFor="follow_up_at">Follow Up</Label>
              <Input
                id="follow_up_at"
                type="datetime-local"
                value={formData.follow_up_at}
                onChange={(e) => setFormData({ ...formData, follow_up_at: e.target.value })}
                disabled={loading}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="appointment_at">{copy.contactDialog.appointmentLabel}</Label>
              <Input
                id="appointment_at"
                type="datetime-local"
                value={formData.appointment_at}
                onChange={(e) => setFormData({ ...formData, appointment_at: e.target.value })}
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex gap-4 justify-end pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !primaryContact.first_name.trim()}>
              {loading ? copy.contactDialog.submitting : showSecondContact ? copy.contactDialog.submitMultiple : copy.contactDialog.submitSingle}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
