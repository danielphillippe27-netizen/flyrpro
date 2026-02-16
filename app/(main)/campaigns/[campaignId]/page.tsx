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
import { LoadingScreen } from '@/components/LoadingScreen';
import { RecipientsTable } from '@/components/RecipientsTable';
import { StatsHeader } from '@/components/StatsHeader';
import { PaywallGuard } from '@/components/PaywallGuard';
import { Label } from '@/components/ui/label';
import { MissingQRModal } from '@/components/modals/MissingQRModal';
import { NonTrackableExportModal } from '@/components/modals/NonTrackableExportModal';
import { DeleteQRCodesButton } from '@/components/qr/DeleteQRCodesButton';
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
  const [showPaywall, setShowPaywall] = useState(false);
  const [showMissingQRModal, setShowMissingQRModal] = useState(false);
  const [missingQRFlyerId, setMissingQRFlyerId] = useState<string | null>(null);
  const [exportWithoutTracking, setExportWithoutTracking] = useState(false);
  const [showNonTrackableModal, setShowNonTrackableModal] = useState(false);
  const [destinationUrl, setDestinationUrl] = useState('');
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [notes, setNotes] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [generatingCanva, setGeneratingCanva] = useState(false);

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

  useEffect(() => {
    if (campaign?.notes !== undefined) setNotes(campaign.notes ?? '');
  }, [campaign?.notes]);

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

  // Generate Canva-ready QRs with S3 upload and CSV download
  const handleGenerateCanvaQRs = async () => {
    if (!addresses?.length) {
      alert('No addresses to generate QRs for');
      return;
    }

    setGeneratingCanva(true);
    try {
      // Transform addresses to Canva format
      const rows = addresses.map((addr) => {
        const parts = (addr.formatted || addr.address || '').split(', ');
        return {
          AddressLine: addr.address || parts[0] || '',
          City: addr.locality || parts[1] || '',
          Province: addr.region || parts[2] || '',
          PostalCode: addr.postal_code || '',
        };
      });

      const response = await fetch('/api/canva/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          baseUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://flyrpro.app'}/api/scan`,
          rows,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Get filename from header
      const contentDisposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : 'canva_bulk.csv';

      // Get metrics from headers
      const uploaded = response.headers.get('X-Canva-Uploaded') || '0';
      const existing = response.headers.get('X-Canva-Existing') || '0';
      const failed = response.headers.get('X-Canva-Failed') || '0';

      // Download the CSV
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert(`Canva CSV generated!\n${uploaded} uploaded, ${existing} existing, ${failed} failed`);
      await loadData();
    } catch (error) {
      console.error('Error generating Canva QRs:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate Canva QRs');
    } finally {
      setGeneratingCanva(false);
    }
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
    const howToCanva = `How to insert into Canva (Bulk Create)

1. In Canva, go to Apps and open "Bulk Create" (or search for it).
2. Upload the CSV: Use "canva_bulk_data.csv" from this ZIP.
   - Canva will use the columns: Address, City, State, Zip, ImageFilename.
3. Add the QR images:
   - The folder "qr-images" contains one PNG per address.
   - In Bulk Create, map the "ImageFilename" column to your design's image placeholder so each row gets the matching QR image.
4. Design your layout with one image placeholder for the QR code; Bulk Create will fill it from the CSV + qr-images.
5. Generate and download your merged designs.

Tip: Keep qr-images and canva_bulk_data.csv in the same place so paths match (or upload the folder to Canva and use the filenames from the CSV).
`;
    zip.file('HOW_TO_INSERT_INTO_CANVA.txt', howToCanva);
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'campaign-qrs-canva.zip');
  };

  const handleSaveNotes = async () => {
    if (!campaignId) return;
    setIsSavingNotes(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ notes: notes || null })
        .eq('id', campaignId);
      if (error) throw error;
      setNotesDirty(false);
      await loadData();
    } catch (e) {
      console.error('Error saving notes:', e);
      alert(e instanceof Error ? e.message : 'Failed to save notes');
    } finally {
      setIsSavingNotes(false);
    }
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



  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <LoadingScreen variant="inline" />
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

  // Dedupe by logical address: one row per (formatted + postal_code), prefer scanned
  const addressKey = (addr: CampaignAddress) =>
    `${(addr.formatted || addr.address || '').trim().toLowerCase()}|${(addr.postal_code || '').trim().toLowerCase()}`;
  const seen = new Map<string, CampaignAddress>();
  for (const addr of addresses) {
    const key = addressKey(addr);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, addr);
    } else if (addr.visited && !existing.visited) {
      seen.set(key, addr);
    } else if (addr.visited === existing.visited && (addr.id < existing.id)) {
      seen.set(key, addr);
    }
  }
  const dedupedAddresses = Array.from(seen.values());

  const formattedRecipients = dedupedAddresses.map((addr) => ({
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
            <TabsTrigger value="doorknocks">Door knocks</TabsTrigger>
            <TabsTrigger value="qr">QR Codes</TabsTrigger>
            <TabsTrigger value="route">Optimized route</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="mt-4 space-y-4">
            <div className="bg-card rounded-xl border border-border overflow-hidden" style={{ height: '560px' }}>
              <CampaignDetailMapView campaignId={campaignId} addresses={addresses} campaign={campaign} onSnapComplete={loadData} />
            </div>
            <Button className="w-full h-12 text-base font-semibold rounded-xl bg-primary hover:bg-primary/90" size="lg">
              Start Session
            </Button>
          </TabsContent>

          <TabsContent value="addresses" className="mt-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Addresses</h2>
              <RecipientsTable recipients={formattedRecipients} campaignId={campaignId} />
            </div>
          </TabsContent>

          <TabsContent value="doorknocks" className="mt-4 space-y-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-2">Visited (door knocked)</h2>
              <p className="text-xs text-muted-foreground mb-3">
                Addresses you’ve marked as visited. Use the Map tab to see all statuses (red = untouched, green = touched, blue = conversations).
              </p>
              {formattedRecipients.filter((r) => r.status === 'scanned').length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No door knocks recorded yet. Mark addresses as visited on the Addresses tab or during a session in the app.</p>
              ) : (
                <RecipientsTable
                  recipients={formattedRecipients.filter((r) => r.status === 'scanned')}
                  campaignId={campaignId}
                />
              )}
            </div>
            <div className="bg-card p-4 rounded-xl border border-border">
              <h3 className="text-sm font-semibold text-foreground mb-2">Conversations</h3>
              <p className="text-xs text-muted-foreground">
                Buildings where you had a conversation appear on the <strong>Map</strong> as blue pins. Open the Map tab and click a blue building to see details in the location card.
              </p>
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
                  {generating ? 'Generating...' : 'Generate QR Codes (In-App)'}
                </Button>
                <Button
                  onClick={handleGenerateCanvaQRs}
                  disabled={generatingCanva || !addresses?.length}
                  variant="secondary"
                >
                  {generatingCanva ? 'Generating...' : 'Generate for Canva (S3 + CSV)'}
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
                  Download (ZIP)
                </Button>
                <DeleteQRCodesButton
                  campaignId={campaignId}
                  onDeleted={loadData}
                  variant="outline"
                  size="sm"
                />
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

          <TabsContent value="notes" className="mt-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Campaign notes</h2>
              <p className="text-xs text-muted-foreground mb-2">
                Free-form notes for this campaign (territory, goals, follow-ups, etc.).
              </p>
              <textarea
                className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
                placeholder="Add notes..."
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesDirty(true);
                }}
              />
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveNotes}
                  disabled={!notesDirty || isSavingNotes}
                >
                  {isSavingNotes ? 'Saving...' : 'Save notes'}
                </Button>
              </div>
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
