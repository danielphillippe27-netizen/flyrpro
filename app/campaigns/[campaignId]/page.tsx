'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignDetailMapView } from '@/components/campaigns/CampaignDetailMapView';
import { RecipientsTable } from '@/components/RecipientsTable';
import { StatsHeader } from '@/components/StatsHeader';
import { PaywallGuard } from '@/components/PaywallGuard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MissingQRModal } from '@/components/modals/MissingQRModal';
import { NonTrackableExportModal } from '@/components/modals/NonTrackableExportModal';
import type { CampaignV2, CampaignAddress } from '@/types/database';

export default function CampaignPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.campaignId as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [campaign, setCampaign] = useState<CampaignV2 | null>(null);
  const [addresses, setAddresses] = useState<CampaignAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showMissingQRModal, setShowMissingQRModal] = useState(false);
  const [missingQRFlyerId, setMissingQRFlyerId] = useState<string | null>(null);
  const [exportWithoutTracking, setExportWithoutTracking] = useState(false);
  const [showNonTrackableModal, setShowNonTrackableModal] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const campaignData = await CampaignsService.fetchCampaign(campaignId);
      const addressesData = await CampaignsService.fetchAddresses(campaignId);
      setCampaign(campaignData);
      setAddresses(addressesData);
    } catch (error) {
      console.error('Error loading campaign:', error);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUploadCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/upload-csv?campaignId=${campaignId}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      await loadData();
      alert('CSV uploaded successfully!');
    } catch (error) {
      console.error('Error uploading CSV:', error);
      alert(error instanceof Error ? error.message : 'Failed to upload CSV');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleGenerateQRs = async (trackable: boolean = true) => {
    setGenerating(true);
    try {
      const response = await fetch(`/api/generate-qrs?campaignId=${campaignId}&trackable=${trackable}`, {
        method: 'POST',
      });

      const data = await response.json();

      if (data.needsUpgrade) {
        setShowPaywall(true);
        return;
      }

      if (!response.ok) {
        // Check for MISSING_QR error
        if (data.error === 'MISSING_QR') {
          setMissingQRFlyerId(data.flyerId || null);
          setShowMissingQRModal(true);
          return;
        }
        throw new Error(data.error || data.message || 'Generation failed');
      }

      await loadData();
      if (trackable) {
        alert(`Generated ${data.count} QR codes!`);
      } else {
        alert('Non-trackable export created successfully.');
      }
      // Reset checkbox after successful export
      setExportWithoutTracking(false);
    } catch (error) {
      console.error('Error generating QRs:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate QR codes');
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirmNonTrackableExport = async () => {
    setShowNonTrackableModal(false);
    await handleGenerateQRs(false);
  };

  const handleAddQR = async () => {
    if (!missingQRFlyerId) {
      setShowMissingQRModal(false);
      return;
    }

    try {
      const response = await fetch(`/api/flyers/${missingQRFlyerId}/add-qr`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add QR');
      }

      // Close modal and retry QR generation
      setShowMissingQRModal(false);
      setMissingQRFlyerId(null);
      await handleGenerateQRs(true);
    } catch (error) {
      console.error('Error adding QR:', error);
      alert(error instanceof Error ? error.message : 'Failed to add QR element');
    }
  };

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const response = await fetch(`/api/zip-qrs?campaignId=${campaignId}`);
      
      const data = await response.json();
      if (data.needsUpgrade) {
        setShowPaywall(true);
        return;
      }

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campaign-${campaignId}-qr-codes.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading ZIP:', error);
      alert('Failed to download QR codes');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Campaign not found</h2>
          <Button asChild>
            <Link href="/home">Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Convert addresses to recipients format for StatsHeader
  const recipients = addresses.map((addr) => ({
    id: addr.id,
    address_line: addr.address,
    city: '',
    region: '',
    postal_code: addr.postal_code || '',
    status: addr.visited ? 'scanned' : 'pending',
    qr_png_url: null,
    sent_at: null,
    scanned_at: addr.visited ? new Date().toISOString() : null,
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Button variant="ghost" asChild className="mb-2">
            <Link href="/home">← Back to Home</Link>
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{campaign.name || 'Unnamed Campaign'}</h1>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={campaign.status === 'active' ? 'default' : 'secondary'}>
                  {campaign.status || 'draft'}
                </Badge>
                {campaign.type && (
                  <span className="text-sm text-gray-600">
                    {(campaign.type || '').replace('_', ' ')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <StatsHeader recipients={recipients} />

        {campaign.total_flyers > 0 && (
          <div className="bg-white rounded-2xl border p-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-600">Campaign Progress</span>
              <span className="text-sm font-bold">{campaign.progress_pct || 0}%</span>
            </div>
            <Progress value={campaign.progress_pct || 0} className="h-3" />
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>{campaign.scans || 0} scans</span>
              <span>{campaign.total_flyers} total addresses</span>
            </div>
          </div>
        )}

        <Tabs defaultValue="addresses" className="w-full">
          <TabsList>
            <TabsTrigger value="addresses">Addresses</TabsTrigger>
            <TabsTrigger value="map">Map</TabsTrigger>
          </TabsList>

          <TabsContent value="addresses" className="mt-6">
            <div className="bg-white rounded-2xl border p-6">
              <h2 className="text-xl font-bold mb-4">Campaign Controls</h2>
              <div className="flex flex-wrap gap-4 mb-6">
                <div>
                  <Label htmlFor="csv-upload" className="cursor-pointer">
                    <Button disabled={uploading} asChild>
                      <span>{uploading ? 'Uploading...' : 'Upload CSV'}</span>
                    </Button>
                  </Label>
                  <Input
                    id="csv-upload"
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleUploadCSV}
                    className="hidden"
                  />
                </div>
                <Button
                  onClick={() => {
                    if (exportWithoutTracking) {
                      setShowNonTrackableModal(true);
                    } else {
                      handleGenerateQRs(true);
                    }
                  }}
                  disabled={generating || addresses.length === 0}
                >
                  {generating ? 'Generating...' : 'Generate QR Codes'}
                </Button>
                <Button
                  onClick={handleDownloadZip}
                  disabled={downloading || addresses.filter(a => a.visited).length === 0}
                  variant="outline"
                >
                  {downloading ? 'Downloading...' : 'Download All QRs (ZIP)'}
                </Button>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Upload a CSV with columns: address_line, city, region, postal_code
              </p>
              
              {/* Advanced Export Options */}
              <div className="border-t pt-4 mt-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="export-without-tracking"
                    checked={exportWithoutTracking}
                    onChange={(e) => setExportWithoutTracking(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <div className="flex-1">
                    <Label htmlFor="export-without-tracking" className="text-sm font-medium cursor-pointer">
                      Export without tracking (no QR)
                    </Label>
                    <p className="text-xs text-gray-600 mt-1">
                      You won't receive scan analytics or address-level attribution for this batch. Use this for generic print jobs that don't need performance tracking.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border p-6 mt-6">
              <h2 className="text-xl font-bold mb-4">Addresses</h2>
              <RecipientsTable recipients={recipients} campaignId={campaignId} />
            </div>
          </TabsContent>

          <TabsContent value="map" className="mt-6">
            <div className="bg-white rounded-2xl border overflow-hidden" style={{ height: '600px' }}>
              <CampaignDetailMapView campaignId={campaignId} addresses={addresses} />
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <PaywallGuard open={showPaywall} onClose={() => setShowPaywall(false)} />
      <MissingQRModal
        open={showMissingQRModal}
        onClose={() => {
          setShowMissingQRModal(false);
          setMissingQRFlyerId(null);
        }}
        onAddQR={handleAddQR}
      />
      <NonTrackableExportModal
        open={showNonTrackableModal}
        onClose={() => setShowNonTrackableModal(false)}
        onConfirm={handleConfirmNonTrackableExport}
      />
    </div>
  );
}
