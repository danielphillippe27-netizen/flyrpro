'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { QRCodeService } from '@/lib/services/QRCodeService';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { LandingPageAnalyticsService } from '@/lib/services/LandingPageAnalyticsService';
import { LandingPageService } from '@/lib/services/LandingPageService';
import { Card } from '@/components/ui/card';
import type { QRCode, CampaignLandingPage } from '@/types/database';

export default function AnalyticsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [qrCodes, setQrCodes] = useState<QRCode[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [landingPages, setLandingPages] = useState<CampaignLandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<Record<string, { scans: number; conversions: number }>>({});
  const [landingPageStats, setLandingPageStats] = useState<Record<string, {
    totalViews: number;
    totalUniqueViews: number;
    totalCTAClicks: number;
    conversionRate: number;
  }>>({});

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
        const campaignData = await CampaignsService.fetchAll(user.id);
        setCampaigns(campaignData || []);

        // Load QR codes for all campaigns
        const allQRCodes: QRCode[] = [];
        for (const campaign of campaignData || []) {
          try {
            const qrData = await QRCodeService.fetchQRCodes({ campaignId: campaign.id });
            allQRCodes.push(...qrData);
          } catch (error) {
            console.error(`Error loading QR codes for campaign ${campaign.id}:`, error);
          }
        }
        setQrCodes(allQRCodes);

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

        // Load analytics for QR codes
        const analyticsData: Record<string, { scans: number; conversions: number }> = {};
        for (const qr of allQRCodes) {
          try {
            const data = await QRCodeService.fetchAnalytics(qr.id);
            analyticsData[qr.id] = {
              scans: data.scans,
              conversions: data.conversions,
            };
          } catch (error) {
            console.error(`Error loading analytics for ${qr.id}:`, error);
          }
        }
        setAnalytics(analyticsData);

        // Load landing page analytics
        const landingPageStatsData: Record<string, {
          totalViews: number;
          totalUniqueViews: number;
          totalCTAClicks: number;
          conversionRate: number;
        }> = {};
        for (const lp of allLandingPages) {
          try {
            const stats = await LandingPageAnalyticsService.getAggregatedStats(lp.id);
            landingPageStatsData[lp.id] = {
              totalViews: stats.totalViews,
              totalUniqueViews: stats.totalUniqueViews,
              totalCTAClicks: stats.totalCTAClicks,
              conversionRate: stats.conversionRate,
            };
          } catch (error) {
            console.error(`Error loading analytics for landing page ${lp.id}:`, error);
          }
        }
        setLandingPageStats(landingPageStatsData);
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

  const totalScans = Object.values(analytics).reduce((sum, a) => sum + a.scans, 0);
  const totalConversions = Object.values(analytics).reduce((sum, a) => sum + a.conversions, 0);
  const conversionRate = totalScans > 0 ? ((totalConversions / totalScans) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-gray-600 mt-1">Track your campaign performance</p>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Overall Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-6">
              <p className="text-sm text-gray-600 mb-2">Total Campaigns</p>
              <p className="text-3xl font-bold">{campaigns.length}</p>
            </Card>
            <Card className="p-6">
              <p className="text-sm text-gray-600 mb-2">Total QR Scans</p>
              <p className="text-3xl font-bold">{totalScans}</p>
            </Card>
            <Card className="p-6">
              <p className="text-sm text-gray-600 mb-2">Conversion Rate</p>
              <p className="text-3xl font-bold">{conversionRate}%</p>
            </Card>
          </div>

          {/* QR Code Analytics */}
          {qrCodes.length > 0 && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">QR Code Performance</h3>
              <div className="space-y-4">
                {qrCodes.map((qr) => {
                  const stats = analytics[qr.id] || { scans: 0, conversions: 0 };
                  return (
                    <div key={qr.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-semibold">{qr.slug || qr.id}</p>
                        <p className="text-sm text-gray-600">{qr.qr_url}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Scans: {stats.scans}</p>
                        <p className="text-sm text-gray-600">Conversions: {stats.conversions}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Landing Page Analytics */}
          {landingPages.length > 0 && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Landing Page Performance</h3>
              <div className="space-y-4">
                {landingPages.map((lp) => {
                  const stats = landingPageStats[lp.id] || {
                    totalViews: 0,
                    totalUniqueViews: 0,
                    totalCTAClicks: 0,
                    conversionRate: 0,
                  };
                  return (
                    <div key={lp.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-semibold">{lp.headline || lp.slug}</p>
                        <p className="text-sm text-gray-600">Slug: {lp.slug}</p>
                        {lp.subheadline && (
                          <p className="text-sm text-gray-500 mt-1">{lp.subheadline}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Views: {stats.totalViews}</p>
                        <p className="text-sm text-gray-600">Unique: {stats.totalUniqueViews}</p>
                        <p className="text-sm text-gray-600">CTA Clicks: {stats.totalCTAClicks}</p>
                        <p className="text-sm font-semibold text-blue-600">
                          Conversion: {stats.conversionRate.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {qrCodes.length === 0 && campaigns.length === 0 && landingPages.length === 0 && (
            <Card className="p-12 text-center">
              <p className="text-gray-600">No analytics data available yet</p>
              <p className="text-sm text-gray-500 mt-2">Create campaigns and QR codes to see analytics</p>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

