'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { LandingPageAnalyticsService } from '@/lib/services/LandingPageAnalyticsService';
import { LandingPageService } from '@/lib/services/LandingPageService';
import { Card } from '@/components/ui/card';
import type { CampaignV2, CampaignLandingPage, QRScanEvent } from '@/types/database';

interface MetricCardProps {
  label: string;
  value: string | number;
  isPlaceholder?: boolean;
}

function MetricCard({ label, value, isPlaceholder = false }: MetricCardProps) {
  return (
    <Card className="p-6 rounded-xl border shadow-sm">
      <p className="text-sm text-muted-foreground mb-2">{label}</p>
      {isPlaceholder ? (
        <p className="text-3xl font-bold text-muted-foreground italic">{value}</p>
      ) : (
        <p className="text-3xl font-bold">{value}</p>
      )}
    </Card>
  );
}

export default function AnalyticsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignV2[]>([]);
  const [landingPages, setLandingPages] = useState<CampaignLandingPage[]>([]);
  const [scanEvents, setScanEvents] = useState<QRScanEvent[]>([]);
  const [landingPageStats, setLandingPageStats] = useState<Record<string, { totalCTAClicks: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      setUserId(user.id);

      try {
        // Load campaigns
        const campaignData = await CampaignsService.fetchCampaignsV2(user.id);
        setCampaigns(campaignData || []);

        const campaignIds = (campaignData || []).map(c => c.id);

        // Load landing pages for all campaigns
        const allLandingPages: CampaignLandingPage[] = [];
        for (const campaign of campaignData || []) {
          try {
            const lpData = await LandingPageService.fetchCampaignLandingPages(campaign.id);
            allLandingPages.push(...lpData);
          } catch (error) {
            console.error(`Error loading landing pages for campaign ${campaign.id}:`, error);
          }
        }
        setLandingPages(allLandingPages);

        // Load all scan events for user's campaigns
        let allScanEvents: QRScanEvent[] = [];
        if (campaignIds.length > 0) {
          const { data: scans, error: scanError } = await supabase
            .from('qr_scan_events')
            .select('*')
            .in('campaign_id', campaignIds)
            .order('created_at', { ascending: false });

          if (scanError) {
            console.error('Error loading scan events:', scanError);
          } else {
            allScanEvents = scans || [];
          }
        }

        // Also try to get scan events by landing page IDs
        const landingPageIds = allLandingPages.map(lp => lp.id);
        if (landingPageIds.length > 0) {
          const { data: scansByLP, error: scanLPError } = await supabase
            .from('qr_scan_events')
            .select('*')
            .in('landing_page_id', landingPageIds);

          if (!scanLPError && scansByLP) {
            // Merge with existing scan events, avoiding duplicates
            const existingScanIds = new Set(allScanEvents.map((s: QRScanEvent) => s.id));
            const newScans = scansByLP.filter((s: QRScanEvent) => !existingScanIds.has(s.id));
            allScanEvents = [...allScanEvents, ...newScans];
          }
        }
        setScanEvents(allScanEvents);

        // Load landing page analytics
        const stats: Record<string, { totalCTAClicks: number }> = {};
        for (const lp of allLandingPages) {
          try {
            const lpStats = await LandingPageAnalyticsService.getAggregatedStats(lp.id);
            stats[lp.id] = { totalCTAClicks: lpStats.totalCTAClicks };
          } catch (error) {
            console.error(`Error loading stats for landing page ${lp.id}:`, error);
            stats[lp.id] = { totalCTAClicks: 0 };
          }
        }
        setLandingPageStats(stats);
      } catch (error) {
        console.error('Error loading analytics data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <h1 className="text-2xl font-bold">Analytics</h1>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12 text-gray-600">Loading analytics...</div>
        </main>
      </div>
    );
  }

  // Calculate metrics
  const totalCampaigns = campaigns.length;
  const totalFlyersDelivered = campaigns.reduce((sum, c) => sum + (c.total_flyers || 0), 0);
  const totalQRScans = scanEvents.length;
  const qrScanRate = totalFlyersDelivered > 0 
    ? ((totalQRScans / totalFlyersDelivered) * 100).toFixed(1) 
    : '0.0';

  // Calculate leads captured (CTA clicks from landing pages)
  const totalLeadsCaptured = Object.values(landingPageStats).reduce(
    (sum, stats) => sum + (stats.totalCTAClicks || 0), 
    0
  );
  const conversionRate = totalQRScans > 0 
    ? ((totalLeadsCaptured / totalQRScans) * 100).toFixed(1) 
    : '0.0';

  // Best time of day for scans
  const scanEventsByHour: Record<number, number> = {};
  scanEvents.forEach(event => {
    if (event.created_at) {
      const hour = new Date(event.created_at).getHours();
      scanEventsByHour[hour] = (scanEventsByHour[hour] || 0) + 1;
    }
  });
  const bestHour = Object.entries(scanEventsByHour).reduce((best, [hour, count]) => {
    return count > best.count ? { hour: parseInt(hour), count } : best;
  }, { hour: 0, count: 0 });
  const bestTimeOfDay = bestHour.count > 0 
    ? `${bestHour.hour}:00 - ${bestHour.hour + 1}:00` 
    : 'Coming soon';

  // Campaign benchmarks
  const campaignsWithScanRate = campaigns.map(c => ({
    ...c,
    scanRate: (c.total_flyers || 0) > 0 ? ((c.scans || 0) / c.total_flyers) * 100 : 0
  }));
  const bestCampaign = campaignsWithScanRate.length > 0
    ? campaignsWithScanRate.reduce((best, c) => c.scanRate > best.scanRate ? c : best)
    : null;
  const worstCampaign = campaignsWithScanRate.length > 0
    ? campaignsWithScanRate.reduce((worst, c) => c.scanRate < worst.scanRate ? c : worst)
    : null;

  // Monthly metrics
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const flyersThisMonth = campaigns
    .filter(c => new Date(c.created_at) >= startOfMonth)
    .reduce((sum, c) => sum + (c.total_flyers || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-gray-600 mt-1">Track your campaign performance</p>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Section 1: Campaign Performance */}
          <section>
            <h2 className="text-xl font-semibold mb-4 pb-2 border-b">Campaign Performance</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard 
                label="Total Campaigns" 
                value={totalCampaigns} 
              />
              <MetricCard 
                label="Campaign Coverage (Houses Reached)" 
                value={totalFlyersDelivered.toLocaleString()} 
              />
              <MetricCard 
                label="Cost per Campaign" 
                value="Coming soon" 
                isPlaceholder={true}
              />
            </div>
          </section>

          {/* Section 2: QR Engagement Metrics */}
          <section>
            <h2 className="text-xl font-semibold mb-4 pb-2 border-b">QR Engagement Metrics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard 
                label="Total QR Scans (Across All Campaigns)" 
                value={totalQRScans.toLocaleString()} 
              />
              <MetricCard 
                label="QR Scan Rate (%)" 
                value={`${qrScanRate}%`} 
              />
              <MetricCard 
                label="Unique Scanners" 
                value="Coming soon" 
                isPlaceholder={true}
              />
              <MetricCard 
                label="Repeat Scanners" 
                value="Coming soon" 
                isPlaceholder={true}
              />
            </div>
          </section>

          {/* Section 3: Lead + Conversion Metrics */}
          <section>
            <h2 className="text-xl font-semibold mb-4 pb-2 border-b">Lead + Conversion Metrics</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard 
                label="Leads Captured" 
                value={totalLeadsCaptured.toLocaleString()} 
              />
              <MetricCard 
                label="Conversion Rate (%)" 
                value={`${conversionRate}%`} 
              />
              <MetricCard 
                label="Contact Attempts Made" 
                value="Coming soon" 
                isPlaceholder={true}
              />
            </div>
          </section>

          {/* Section 4: Map-Based Insights */}
          <section>
            <h2 className="text-xl font-semibold mb-4 pb-2 border-b">Map-Based Insights</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard 
                label="Hot Blocks" 
                value="Coming soon" 
                isPlaceholder={true}
              />
              <MetricCard 
                label="Scan Density by Street" 
                value="Coming soon" 
                isPlaceholder={true}
              />
              <MetricCard 
                label="Best Time of Day for Scans" 
                value={bestTimeOfDay} 
              />
            </div>
          </section>

          {/* Section 5: Campaign Benchmarks */}
          <section>
            <h2 className="text-xl font-semibold mb-4 pb-2 border-b">Campaign Benchmarks</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-6 rounded-xl border shadow-sm">
                <p className="text-sm text-muted-foreground mb-2">Your Best Performing Campaign</p>
                {bestCampaign ? (
                  <div>
                    <p className="text-2xl font-bold mb-1">{bestCampaign.name}</p>
                    <p className="text-sm text-muted-foreground">Scan Rate: {bestCampaign.scanRate.toFixed(1)}%</p>
                  </div>
                ) : (
                  <p className="text-3xl font-bold text-muted-foreground">N/A</p>
                )}
              </Card>
              <Card className="p-6 rounded-xl border shadow-sm">
                <p className="text-sm text-muted-foreground mb-2">Your Worst Performing Campaign</p>
                {worstCampaign ? (
                  <div>
                    <p className="text-2xl font-bold mb-1">{worstCampaign.name}</p>
                    <p className="text-sm text-muted-foreground">Scan Rate: {worstCampaign.scanRate.toFixed(1)}%</p>
                  </div>
                ) : (
                  <p className="text-3xl font-bold text-muted-foreground">N/A</p>
                )}
              </Card>
              <MetricCard 
                label="Avg Scan Rate in Your City" 
                value="Coming soon" 
                isPlaceholder={true}
              />
            </div>
          </section>

          {/* Section 6: Operational Metrics */}
          <section>
            <h2 className="text-xl font-semibold mb-4 pb-2 border-b">Operational Metrics</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard 
                label="Flyers Printed This Month" 
                value={flyersThisMonth.toLocaleString()} 
              />
              <MetricCard 
                label="Spend This Month" 
                value="Coming soon" 
                isPlaceholder={true}
              />
              <MetricCard 
                label="Time Saved by FLYR" 
                value="Coming soon" 
                isPlaceholder={true}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
