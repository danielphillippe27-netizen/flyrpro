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
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { createClient } from '@/lib/supabase/client';

export default function CampaignPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.campaignId as string;

  const [campaign, setCampaign] = useState<CampaignV2 | null>(null);
  const [addresses, setAddresses] = useState<CampaignAddress[]>([]);
  const [loading, setLoading] = useState(true);
  // Removed syncing state - no longer needed for mission-based provisioning
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showMissingQRModal, setShowMissingQRModal] = useState(false);
  const [missingQRFlyerId, setMissingQRFlyerId] = useState<string | null>(null);
  const [exportWithoutTracking, setExportWithoutTracking] = useState(false);
  const [showNonTrackableModal, setShowNonTrackableModal] = useState(false);
  const [destinationUrl, setDestinationUrl] = useState("");
  const [isSavingUrl, setIsSavingUrl] = useState(false);

  const loadData = useCallback(async () => {
    try {
      console.log('Loading campaign:', campaignId);
      const campaignData = await CampaignsService.fetchCampaign(campaignId);
      
      if (!campaignData) {
        console.error('Campaign not found:', campaignId);
        return;
      }
      
      console.log('Campaign loaded:', campaignData);
      
      // Fetch from campaign_addresses (primary source for addresses)
      const addressesData = await CampaignsService.fetchAddresses(campaignId);
      console.log('Addresses loaded:', addressesData.length);
      
      setCampaign(campaignData);
      setAddresses(addressesData);
    } catch (error) {
      console.error('Error loading campaign:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load existing video_url when campaign data is available
  useEffect(() => {
    if (campaign?.video_url) {
      setDestinationUrl(campaign.video_url);
    }
  }, [campaign]);

  // Removed handleSyncNeighborhood - buildings are now provisioned during campaign creation
  // Mission-based provisioning: buildings are generated when territory is defined

  const handleGenerateQRs = async (trackable: boolean = true) => {
    setGenerating(true);
    try {
      const response = await fetch('/api/generate-qrs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId: campaignId,
          trackable: trackable,
          baseUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
        }),
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

  const handleSaveUrl = async () => {
    setIsSavingUrl(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ video_url: destinationUrl || null })
        .eq('id', campaignId);
      
      if (error) {
        alert("Error saving URL: " + error.message);
      } else {
        alert("Destination URL Saved! All QR codes now point here.");
        await loadData(); // Reload to get updated campaign data
      }
    } catch (error) {
      alert("Error saving URL");
    } finally {
      setIsSavingUrl(false);
    }
  };

  const handleDownloadForCanva = async () => {
    if (!addresses || addresses.length === 0) {
      alert("No addresses to download");
      return;
    }

    const zip = new JSZip();
    const imgFolder = zip.folder("qr-images");
    
    // CSV header - ImageFilename must match filenames exactly for Canva Bulk Create
    let csvContent = "Address,City,State,Zip,ImageFilename\n";

    addresses.forEach((addr) => {
      if (addr.qr_code_base64) {
        // 1. Clean filename (remove weird characters, limit length)
        const cleanAddress = (addr.formatted || addr.address || 'address')
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .trim()
          .replace(/\s+/g, '-')
          .substring(0, 50);
        const filename = `${cleanAddress}.png`;

        // 2. Extract base64 data (strip data:image/png;base64, prefix)
        const base64Data = addr.qr_code_base64.split(',')[1];
        imgFolder?.file(filename, base64Data, { base64: true });

        // 3. Build CSV row
        // Extract city/state from formatted address if available
        const addressParts = (addr.formatted || addr.address || '').split(',');
        const city = addressParts.length > 1 ? addressParts[1].trim() : '';
        const state = addressParts.length > 2 ? addressParts[2].trim() : '';
        
        csvContent += `"${addr.formatted || addr.address || ''}","${city}","${state}","${addr.postal_code || ''}","${filename}"\n`;
      }
    });

    // 4. Add CSV to ZIP root
    zip.file("canva_bulk_data.csv", csvContent);

    // 5. Generate and download
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `campaign-qrs-canva.zip`);
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

  // Convert addresses from campaign_addresses to the format expected by StatsHeader and RecipientsTable
  const formattedRecipients = addresses.map((addr) => ({
    id: addr.id,
    address_line: addr.formatted || addr.address || '',
    city: '',
    region: '',
    postal_code: addr.postal_code || '',
    status: addr.visited ? 'scanned' : 'pending',
    qr_png_url: null,
    qr_code_base64: addr.qr_code_base64 || null,  // NEW: Include QR code
    sent_at: null,
    scanned_at: addr.visited ? new Date().toISOString() : null,
    street_name: addr.street_name,
    seq: addr.seq,
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
              {addresses.length > 0 && (
                <div className="mt-3">
                  <span className="text-sm font-medium text-gray-700">
                    Addresses loaded: {addresses.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <StatsHeader recipients={formattedRecipients} />

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
            {/* QR Destination URL Input */}
            <div className="bg-white p-6 rounded-lg shadow mb-6 border border-gray-200">
              <h3 className="text-lg font-medium text-gray-900 mb-4">📍 QR Destination</h3>
              <div className="flex gap-4">
                <div className="flex-grow">
                  <label htmlFor="url" className="sr-only">Destination URL</label>
                  <input
                    type="url"
                    id="url"
                    placeholder="https://youtube.com/watch?v=..."
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                    value={destinationUrl}
                    onChange={(e) => setDestinationUrl(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Where should users go when they scan? (Leave empty to use the "Welcome" page).
                  </p>
                </div>
                <button
                  onClick={handleSaveUrl}
                  disabled={isSavingUrl}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none disabled:opacity-50"
                >
                  {isSavingUrl ? "Saving..." : "Link URL"}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border p-6">
              <h2 className="text-xl font-bold mb-4">Campaign Controls</h2>
              <div className="flex flex-wrap gap-4 mb-6">
                <Button
                  onClick={() => {
                    if (exportWithoutTracking) {
                      setShowNonTrackableModal(true);
                    } else {
                      handleGenerateQRs(true);
                    }
                  }}
                  disabled={generating || formattedRecipients.length === 0}
                >
                  {generating ? 'Generating...' : 'Generate QR Codes'}
                </Button>
                <Button
                  onClick={handleDownloadForCanva}
                  disabled={!addresses || addresses.length === 0 || addresses.filter(a => a.qr_code_base64).length === 0}
                  variant="outline"
                >
                  Download for Canva (ZIP)
                </Button>
                <Button
                  onClick={handleDownloadZip}
                  disabled={downloading || formattedRecipients.filter((r: any) => r.status === 'scanned').length === 0}
                  variant="outline"
                >
                  {downloading ? 'Downloading...' : 'Download All QRs (ZIP)'}
                </Button>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Buildings are automatically provisioned when you create a campaign with a territory boundary. The map shows only buildings for this campaign.
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
              <RecipientsTable recipients={formattedRecipients} campaignId={campaignId} />
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
