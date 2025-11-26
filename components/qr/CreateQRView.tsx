'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { QRCodeService } from '@/lib/services/QRCodeService';
import { createClient } from '@/lib/supabase/client';

export function CreateQRView({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [source, setSource] = useState<'campaign' | 'farm' | 'address'>('campaign');
  const [campaignId, setCampaignId] = useState('');
  const [landingPageId, setLandingPageId] = useState('');
  const [qrVariant, setQrVariant] = useState<'A' | 'B' | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Generate QR URL
      const baseUrl = window.location.origin;
      const slug = `qr-${Date.now()}`;
      const qrUrl = `${baseUrl}/q/${slug}`;

      await QRCodeService.createQRCode({
        campaignId: source === 'campaign' ? campaignId : undefined,
        landingPageId: landingPageId || undefined,
        qrVariant,
        slug,
        qrUrl,
      });

      onClose();
    } catch (error) {
      console.error('Error creating QR code:', error);
      alert('Failed to create QR code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create QR Code</DialogTitle>
            <DialogDescription>
              Generate a new QR code for tracking
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="source">Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="campaign">Campaign</SelectItem>
                  <SelectItem value="farm">Farm</SelectItem>
                  <SelectItem value="address">Address</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {source === 'campaign' && (
              <div className="grid gap-2">
                <Label htmlFor="campaignId">Campaign ID</Label>
                <Input
                  id="campaignId"
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  placeholder="Enter campaign ID"
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="landingPageId">Landing Page ID (Optional)</Label>
              <Input
                id="landingPageId"
                value={landingPageId}
                onChange={(e) => setLandingPageId(e.target.value)}
                placeholder="Enter landing page ID"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="variant">A/B Test Variant (Optional)</Label>
              <Select value={qrVariant || 'none'} onValueChange={(v) => setQrVariant(v === 'none' ? undefined : v as 'A' | 'B')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select variant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="A">Variant A</SelectItem>
                  <SelectItem value="B">Variant B</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create QR Code'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

