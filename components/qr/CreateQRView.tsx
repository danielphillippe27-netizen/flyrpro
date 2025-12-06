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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { QRDestinationType } from '@/lib/services/QRCodeService';

export function CreateQRView({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [source, setSource] = useState<'campaign' | 'farm' | 'address'>('campaign');
  const [campaignId, setCampaignId] = useState('');
  const [addressId, setAddressId] = useState('');
  const [destinationType, setDestinationType] = useState<QRDestinationType>('landingPage');
  const [landingPageId, setLandingPageId] = useState('');
  const [directUrl, setDirectUrl] = useState('');
  const [qrVariant, setQrVariant] = useState<'A' | 'B' | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Validate direct URL format if directLink is selected
      if (destinationType === 'directLink') {
        if (!directUrl) {
          setError('Direct URL is required');
          setLoading(false);
          return;
        }
        if (!directUrl.match(/^https?:\/\//)) {
          setError('Direct URL must start with http:// or https://');
          setLoading(false);
          return;
        }
      }

      // Validate landing page ID if landingPage is selected
      if (destinationType === 'landingPage' && !landingPageId) {
        setError('Landing page ID is required');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/qr/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId: source === 'campaign' ? campaignId : null,
          addressId: source === 'address' ? addressId : null,
          destinationType,
          landingPageId: destinationType === 'landingPage' ? landingPageId : null,
          directUrl: destinationType === 'directLink' ? directUrl : null,
          qrVariant,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create QR code');
      }

      const { data } = await response.json();
      console.log('QR code created:', data);
      onClose();
    } catch (error: any) {
      console.error('Error creating QR code:', error);
      setError(error.message || 'Failed to create QR code');
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

            {source === 'address' && (
              <div className="grid gap-2">
                <Label htmlFor="addressId">Address ID</Label>
                <Input
                  id="addressId"
                  value={addressId}
                  onChange={(e) => setAddressId(e.target.value)}
                  placeholder="Enter address ID"
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label>Destination Type</Label>
              <Tabs value={destinationType} onValueChange={(v) => setDestinationType(v as QRDestinationType)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="landingPage">Link to Landing Page</TabsTrigger>
                  <TabsTrigger value="directLink">Link to Direct URL</TabsTrigger>
                </TabsList>
                <TabsContent value="landingPage" className="mt-4">
                  <div className="grid gap-2">
                    <Label htmlFor="landingPageId">Landing Page ID</Label>
                    <Input
                      id="landingPageId"
                      value={landingPageId}
                      onChange={(e) => setLandingPageId(e.target.value)}
                      placeholder="Enter landing page ID"
                      required
                    />
                  </div>
                </TabsContent>
                <TabsContent value="directLink" className="mt-4">
                  <div className="grid gap-2">
                    <Label htmlFor="directUrl">Destination URL</Label>
                    <Input
                      id="directUrl"
                      type="url"
                      value={directUrl}
                      onChange={(e) => setDirectUrl(e.target.value)}
                      placeholder="https://example.com/..."
                      required
                    />
                    <p className="text-xs text-gray-500">
                      Must start with http:// or https://
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
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

            {error && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            )}
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

