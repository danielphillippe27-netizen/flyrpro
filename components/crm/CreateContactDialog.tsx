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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ContactsService } from '@/lib/services/ContactsService';
import type { ContactStatus } from '@/types/database';

interface CreateContactDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId: string;
  workspaceId?: string;
  initialAddress?: string;
  initialAddressId?: string;
  initialCampaignId?: string;
  initialNotes?: string;
}

export function CreateContactDialog({
  open,
  onClose,
  onSuccess,
  userId,
  workspaceId,
  initialAddress,
  initialAddressId,
  initialCampaignId,
  initialNotes,
}: CreateContactDialogProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    address: initialAddress || '',
    status: 'new' as ContactStatus,
    notes: initialNotes || '',
    tags: '',
  });

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
    if (!formData.first_name.trim()) {
      alert('Please fill in the required field: First Name');
      return;
    }

    setLoading(true);
    try {
      // Use createContactWithAddress if address_id is provided
      if (initialAddressId) {
        await ContactsService.createContactWithAddress(userId, {
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim() || undefined,
          phone: formData.phone.trim() || undefined,
          email: formData.email.trim() || undefined,
          address: formData.address.trim() || undefined,
          campaign_id: initialCampaignId,
          status: formData.status,
          notes: formData.notes.trim() || undefined,
          address_id: initialAddressId,
          tags: formData.tags.trim() || undefined,
        }, workspaceId);
      } else {
        await ContactsService.createContact(userId, {
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim() || undefined,
          phone: formData.phone.trim() || undefined,
          email: formData.email.trim() || undefined,
          address: formData.address.trim() || undefined,
          campaign_id: initialCampaignId,
          status: formData.status,
          notes: formData.notes.trim() || undefined,
          tags: formData.tags.trim() || undefined,
        }, workspaceId);
      }

      // Reset form
      setFormData({
        first_name: '',
        last_name: '',
        phone: '',
        email: '',
        address: '',
        status: 'new',
        notes: '',
        tags: '',
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
      setFormData({
        first_name: '',
        last_name: '',
        phone: '',
        email: '',
        address: '',
        status: 'new',
        notes: '',
        tags: '',
      });
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Contact</DialogTitle>
          <DialogDescription>
            Add a new lead
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="first_name">
                First Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                placeholder="John"
                required
                disabled={loading}
              />
            </div>
            <div>
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                placeholder="Doe"
                disabled={loading}
              />
            </div>
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
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="(555) 123-4567"
              disabled={loading}
            />
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="john@example.com"
              disabled={loading}
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

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes about this contact..."
              disabled={loading}
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              placeholder="Tag1, Tag2, Tag3"
              disabled={loading}
            />
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
            <Button type="submit" disabled={loading || !formData.first_name.trim()}>
              {loading ? 'Creating...' : 'Create Contact'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

