'use client';

import { useState, useEffect } from 'react';
import type { QRCode } from '@/types/database';
import { QRCodeService } from '@/lib/services/QRCodeService';
import { Card } from '@/components/ui/card';

export function QRCodeAnalyticsView({ qrCodes }: { qrCodes: QRCode[] }) {
  const [analytics, setAnalytics] = useState<Record<string, { scans: number; conversions: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAnalytics = async () => {
      const analyticsData: Record<string, { scans: number; conversions: number }> = {};
      
      for (const qr of qrCodes) {
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
      setLoading(false);
    };

    if (qrCodes.length > 0) {
      loadAnalytics();
    } else {
      setLoading(false);
    }
  }, [qrCodes]);

  if (loading) {
    return <div className="text-center py-8 text-gray-600">Loading analytics...</div>;
  }

  if (qrCodes.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border">
        <p className="text-gray-600">No QR codes to analyze</p>
      </div>
    );
  }

  const totalScans = Object.values(analytics).reduce((sum, a) => sum + a.scans, 0);
  const totalConversions = Object.values(analytics).reduce((sum, a) => sum + a.conversions, 0);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Overall Statistics</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total Scans</p>
            <p className="text-2xl font-bold">{totalScans}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Total Conversions</p>
            <p className="text-2xl font-bold">{totalConversions}</p>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Per QR Code</h3>
        {qrCodes.map((qr) => {
          const stats = analytics[qr.id] || { scans: 0, conversions: 0 };
          return (
            <Card key={qr.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold">{qr.slug || qr.id}</p>
                  <p className="text-sm text-gray-600">{qr.qr_url}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">Scans</p>
                  <p className="text-xl font-bold">{stats.scans}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

