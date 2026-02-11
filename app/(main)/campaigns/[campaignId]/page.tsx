'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CampaignsService, type CampaignStats } from '@/lib/services/CampaignsService';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignDetailMapView } from '@/components/campaigns/CampaignDetailMapView';
import { OptimizedRouteView } from '@/components/campaigns/OptimizedRouteView';
import { RecipientsTable } from '@/components/RecipientsTable';
import { StatsHeader } from '@/components/StatsHeader';
import { PaywallGuard } from '@/components/PaywallGuard';
import { Label } from '@/components/ui/label';
import { MissingQRModal } from '@/components/modals/MissingQRModal';
import { NonTrackableExportModal } from '@/components/modals/NonTrackableExportModal';
import type { CampaignV2, CampaignAddress } from '@/types/database';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { createClient } from '@/lib/supabase/client';

export default function CampaignDetailPage() {
  const params = useParams();
  const campaignId = params.campaignId as string;

  const [campaign, setCampaign] = useState<CampaignV2 | null>(null);
  const [addresses, setAddresses] = useState<CampaignAddress[]>([]);
  const [campaignStats, setCampaignStats] = useState<CampaignStats>({
    addresses: 0,
    buildings: 0,
    visited: 0,
    scanned: 0,
    scan_rate: 0,
    progress_pct: 0,
  });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showMissingQRModal, setShowMissingQRModal] = useState(false);
  const [missingQRFlyerId, setMissingQRFlyerId] = useState<string | null>(null);
  const [exportWithoutTracking, setExportWithoutTracking] = useState(false);
  const [showNonTrackableModal, setShowNonTrackableModal] = useState(false);
  const [destinationUrl, setDestinationUrl] = useState('');
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  

  const loadData = useCallback(async () => {
    try {
      const campaignData = await CampaignsService.fetchCampaign(campaignId);
      if (!campaignData) return;
      const addressesData = await CampaignsService.fetchAddresses(campaignId);
      const statsData = await CampaignsService.fetchCampaignStats(campaignId);
      setCampaign(campaignData);
      setAddresses(addressesData);
      setCampaignStats(statsData);
    } catch (error) {
      console.error('Error loading campaign:', error);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (campaign?.video_url) setDestinationUrl(campaign.video_url);
  }, [campaign]);

  const handleGenerateQRs = async (trackable: boolean = true) => {
    setGenerating(true);
    try {
      const response = await fetch('/api/generate-qrs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          trackable,
          baseUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
        }),
      });
      const data = await response.json();
      if (data.needsUpgrade) {
        setShowPaywall(true);
        return;
      }
      if (!response.ok) {
        if (data.error === 'MISSING_QR') {
          setMissingQRFlyerId(data.flyerId || null);
          setShowMissingQRModal(true);
          return;
        }
        throw new Error(data.error || data.message || 'Generation failed');
      }
      await loadData();
      if (trackable) alert(`Generated ${data.count} QR codes!`);
      else alert('Non-trackable export created successfully.');
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

  const handleSaveUrl = async () => {
    setIsSavingUrl(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ video_url: destinationUrl || null })
        .eq('id', campaignId);
      if (error) alert('Error saving URL: ' + error.message);
      else {
        alert('Destination URL Saved! All QR codes now point here.');
        await loadData();
      }
    } catch {
      alert('Error saving URL');
    } finally {
      setIsSavingUrl(false);
    }
  };

  const handleDownloadForCanva = async () => {
    if (!addresses?.length) {
      alert('No addresses to download');
      return;
    }
    const zip = new JSZip();
    const imgFolder = zip.folder('qr-images');
    let csvContent = 'Address,City,State,Zip,ImageFilename\n';
    addresses.forEach((addr) => {
      if (addr.qr_code_base64) {
        const cleanAddress = (addr.formatted || addr.address || 'address')
          .replace(/[^a-zA-Z0-9 ]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .substring(0, 50);
        const filename = `${cleanAddress}.png`;
        const base64Data = addr.qr_code_base64.split(',')[1];
        imgFolder?.file(filename, base64Data, { base64: true });
        const addressParts = (addr.formatted || addr.address || '').split(',');
        const city = addressParts.length > 1 ? addressParts[1].trim() : '';
        const state = addressParts.length > 2 ? addressParts[2].trim() : '';
        csvContent += `"${addr.formatted || addr.address || ''}","${city}","${state}","${addr.postal_code || ''}","${filename}"\n`;
      }
    });
    zip.file('canva_bulk_data.csv', csvContent);
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'campaign-qrs-canva.zip');
  };

  const handleAddQR = async () => {
    if (!missingQRFlyerId) {
      setShowMissingQRModal(false);
      return;
    }
    try {
      const response = await fetch(`/api/flyers/${missingQRFlyerId}/add-qr`, { method: 'POST' });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add QR');
      }
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
      if (!response.ok) throw new Error('Download failed');
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
      <div className="flex items-center justify-center min-h-[320px] text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] px-6 text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">Campaign not found</h2>
        <Button asChild variant="outline">
          <Link href="/campaigns">Back to Campaigns</Link>
        </Button>
      </div>
    );
  }

  const formattedRecipients = addresses.map((addr) => ({
    id: addr.id,
    address_line: addr.formatted || addr.address || '',
    city: addr.locality || '',
    region: addr.region || '',
    postal_code: addr.postal_code || '',
    status: addr.visited ? 'scanned' : 'pending',
    qr_png_url: null,
    qr_code_base64: addr.qr_code_base64 || null,
    sent_at: null,
    scanned_at: addr.visited ? new Date().toISOString() : null,
    street_name: addr.street_name,
    house_number: addr.house_number,
    locality: addr.locality,
    seq: addr.seq,
  }));

  return (
    <div className="min-h-full bg-muted/30 dark:bg-background">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-6">
            <h1 className="text-xl font-bold text-foreground">{campaign.name || 'Unnamed Campaign'}</h1>
            {campaignStats.buildings > 0 && (
              <div className="flex-1 min-w-0 max-w-md sm:max-w-lg flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Progress</span>
                <Progress value={campaignStats.progress_pct} className="h-2 flex-1" />
                <span className="text-sm font-semibold text-foreground whitespace-nowrap">{campaignStats.progress_pct}%</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <StatsHeader stats={campaignStats} />

        <Tabs defaultValue="map" className="w-full">
          <TabsList>
            <TabsTrigger value="map">Map</TabsTrigger>
            <TabsTrigger value="addresses">Addresses</TabsTrigger>
            <TabsTrigger value="qr">QR Codes</TabsTrigger>
            <TabsTrigger value="route">Optimized route</TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="mt-4">
            <div className="bg-card rounded-xl border border-border overflow-hidden" style={{ height: '560px' }}>
              <CampaignDetailMapView campaignId={campaignId} addresses={addresses} />
            </div>
          </TabsContent>

          <TabsContent value="addresses" className="mt-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Addresses</h2>
              <RecipientsTable recipients={formattedRecipients} campaignId={campaignId} />
            </div>
          </TabsContent>

          <TabsContent value="qr" className="mt-4 space-y-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h3 className="text-sm font-semibold text-foreground mb-3">QR Destination</h3>
              <div className="flex gap-3 flex-wrap">
                <input
                  type="url"
                  id="campaign-destination-url"
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                />
                <Button onClick={handleSaveUrl} disabled={isSavingUrl} size="sm">
                  {isSavingUrl ? 'Saving...' : 'Link URL'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Where users go when they scan. Leave empty to use the Welcome page.
              </p>
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Campaign Controls</h2>
              <div className="flex flex-wrap gap-3 mb-4">
                <Button
                  onClick={() =>
                    exportWithoutTracking ? setShowNonTrackableModal(true) : handleGenerateQRs(true)
                  }
                  disabled={generating || formattedRecipients.length === 0}
                >
                  {generating ? 'Generating...' : 'Generate QR Codes'}
                </Button>
                <Button
                  onClick={handleDownloadForCanva}
                  disabled={
                    !addresses?.length ||
                    addresses.filter((a) => a.qr_code_base64).length === 0
                  }
                  variant="outline"
                  size="sm"
                >
                  Download for Canva (ZIP)
                </Button>
                <Button
                  onClick={handleDownloadZip}
                  disabled={
                    downloading ||
                    formattedRecipients.filter((r: { status: string }) => r.status === 'scanned').length === 0
                  }
                  variant="outline"
                  size="sm"
                >
                  {downloading ? 'Downloading...' : 'Download All QRs (ZIP)'}
                </Button>
              </div>
              <div className="flex items-start gap-3 pt-3 border-t border-border">
                <input
                  type="checkbox"
                  id="export-without-tracking"
                  checked={exportWithoutTracking}
                  onChange={(e) => setExportWithoutTracking(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
                />
                <div>
                  <Label htmlFor="export-without-tracking" className="text-sm font-medium cursor-pointer">
                    Export without tracking (no QR)
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    No scan analytics or address-level attribution for this batch.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="route" className="mt-4">
            <OptimizedRouteView 
              campaignId={campaignId} 
              addresses={addresses} 
              onAddressesUpdate={(freshAddresses) => {
                // Cast to CampaignAddress[] since the types are compatible
                setAddresses(freshAddresses as CampaignAddress[]);
              }}
            />
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
