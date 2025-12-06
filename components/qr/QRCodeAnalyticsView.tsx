'use client';

import { useState, useEffect } from 'react';
import type { QRCode } from '@/types/database';
import { Card } from '@/components/ui/card';

interface QRCodeWithScans extends QRCode {
  scanCount?: number;
  destination_type?: 'landingPage' | 'directLink' | null;
}

export function QRCodeAnalyticsView({ 
  qrCodes,
  campaignId 
}: { 
  qrCodes: QRCode[];
  campaignId?: string;
}) {
  const [analytics, setAnalytics] = useState<Record<string, { scans: number; destinationType?: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        if (campaignId) {
          // Use campaign-based analytics endpoint
          const response = await fetch('/api/qr/analytics', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ campaignId }),
          });

          if (!response.ok) {
            throw new Error('Failed to fetch campaign QR analytics');
          }

          const { data: qrCodesWithScans } = await response.json();
          const analyticsData: Record<string, { scans: number; destinationType?: string }> = {};
          
          qrCodesWithScans.forEach((qr: QRCodeWithScans) => {
            analyticsData[qr.id] = {
              scans: qr.scanCount || 0,
              destinationType: qr.destination_type || 'landingPage',
            };
          });

          setAnalytics(analyticsData);
        } else {
          // Fallback: fetch scan counts for individual QR codes
          const qrCodeIds = qrCodes.map((qr) => qr.id);
          const response = await fetch('/api/qr/analytics', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ qrCodeIds }),
          });

          if (!response.ok) {
            throw new Error('Failed to fetch QR analytics');
          }

          const { data: scanData } = await response.json();
          const analyticsData: Record<string, { scans: number; destinationType?: string }> = {};
          
          qrCodes.forEach((qr) => {
            analyticsData[qr.id] = {
              scans: scanData[qr.id] || 0,
              destinationType: qr.destination_type || 'landingPage',
            };
          });

          setAnalytics(analyticsData);
        }
      } catch (error) {
        console.error('Error loading analytics:', error);
        // Set empty analytics on error
        const emptyAnalytics: Record<string, { scans: number; destinationType?: string }> = {};
        qrCodes.forEach((qr) => {
          emptyAnalytics[qr.id] = {
            scans: 0,
            destinationType: qr.destination_type || 'landingPage',
          };
        });
        setAnalytics(emptyAnalytics);
      } finally {
        setLoading(false);
      }
    };

    if (qrCodes.length > 0) {
      loadAnalytics();
    } else {
      setLoading(false);
    }
  }, [qrCodes, campaignId]);

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

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Overall Statistics</h3>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total Scans</p>
            <p className="text-2xl font-bold">{totalScans}</p>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Per QR Code</h3>
        {qrCodes.map((qr) => {
          const stats = analytics[qr.id] || { scans: 0, destinationType: 'landingPage' };
          const destinationTypeLabel = stats.destinationType === 'directLink' ? 'Direct Link' : 'Landing Page';
          return (
            <Card key={qr.id} className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="font-semibold">{qr.slug || qr.id}</p>
                  <p className="text-sm text-gray-600">{qr.qr_url}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Type: {destinationTypeLabel}
                  </p>
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

