'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { RecipientsTable } from '@/components/RecipientsTable';
import { StatsHeader } from '@/components/StatsHeader';
import { PaywallGuard } from '@/components/PaywallGuard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Campaign {
  id: string;
  name: string;
  destination_url: string;
}

interface Recipient {
  id: string;
  address_line: string;
  city: string;
  region: string;
  postal_code: string;
  status: string;
  qr_png_url: string | null;
  sent_at: string | null;
  scanned_at: string | null;
}

export default function CampaignPage() {
  const params = useParams();
  const campaignId = params.id as string;
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const { data: campaignData } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .single();

      const { data: recipientsData } = await supabase
        .from('campaign_recipients')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false });

      setCampaign(campaignData);
      setRecipients(recipientsData || []);
    } catch (error) {
      console.error('Error loading campaign:', error);
    } finally {
      setLoading(false);
    }
  }, [campaignId, supabase]);

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

  const handleGenerateQRs = async () => {
    setGenerating(true);
    try {
      const response = await fetch(`/api/generate-qrs?campaignId=${campaignId}`, {
        method: 'POST',
      });

      const data = await response.json();

      if (data.needsUpgrade) {
        setShowPaywall(true);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Generation failed');
      }

      await loadData();
      alert(`Generated ${data.count} QR codes!`);
    } catch (error) {
      console.error('Error generating QRs:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate QR codes');
    } finally {
      setGenerating(false);
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
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Button variant="ghost" asChild className="mb-2">
            <Link href="/dashboard">← Back to Dashboard</Link>
          </Button>
          <h1 className="text-2xl font-bold">{campaign.name}</h1>
          <p className="text-gray-600 text-sm">{campaign.destination_url}</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <StatsHeader recipients={recipients} />

        <div className="bg-white rounded-2xl border p-6">
          <h2 className="text-xl font-bold mb-4">Campaign Controls</h2>
          <div className="flex flex-wrap gap-4">
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
              onClick={handleGenerateQRs}
              disabled={generating || recipients.length === 0}
            >
              {generating ? 'Generating...' : 'Generate QR Codes'}
            </Button>
            <Button
              onClick={handleDownloadZip}
              disabled={downloading || recipients.filter(r => r.qr_png_url).length === 0}
              variant="outline"
            >
              {downloading ? 'Downloading...' : 'Download All QRs (ZIP)'}
            </Button>
          </div>
          <p className="text-sm text-gray-600 mt-4">
            Upload a CSV with columns: address_line, city, region, postal_code
          </p>
        </div>

        <div className="bg-white rounded-2xl border p-6">
          <h2 className="text-xl font-bold mb-4">Recipients</h2>
          <RecipientsTable recipients={recipients} campaignId={campaignId} />
        </div>
      </main>

      <PaywallGuard open={showPaywall} onClose={() => setShowPaywall(false)} />
    </div>
  );
}

