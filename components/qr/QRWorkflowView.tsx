'use client';

import { useState, useEffect } from 'react';
import { Plus, QrCode, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreateQRView } from './CreateQRView';
import { QRCodeAnalyticsView } from './QRCodeAnalyticsView';
import { QRCodeService } from '@/lib/services/QRCodeService';
import type { QRCode } from '@/types/database';
import { createClient } from '@/lib/supabase/client';

export function QRWorkflowView() {
  const [qrCodes, setQRCodes] = useState<QRCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
      if (user?.id) {
        loadQRCodes();
      }
    });
  }, []);

  const loadQRCodes = async () => {
    try {
      const data = await QRCodeService.fetchQRCodes();
      setQRCodes(data);
    } catch (error) {
      console.error('Error loading QR codes:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-600">Loading QR codes...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">QR Code Management</h2>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create QR Code
        </Button>
      </div>

      <Tabs defaultValue="codes" className="w-full">
        <TabsList>
          <TabsTrigger value="codes">
            <QrCode className="w-4 h-4 mr-2" />
            My QR Codes
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="w-4 h-4 mr-2" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="codes" className="mt-6">
          {qrCodes.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border">
              <QrCode className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600 mb-2">No QR codes yet</p>
              <p className="text-sm text-gray-500 mb-4">Create your first QR code to get started</p>
              <Button onClick={() => setShowCreate(true)}>Create QR Code</Button>
            </div>
          ) : (
            <div className="grid gap-4">
              {qrCodes.map((qr) => (
                <div key={qr.id} className="bg-white rounded-lg border p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{qr.slug || qr.id}</h3>
                      <p className="text-sm text-gray-600 mt-1">{qr.qr_url}</p>
                      {qr.metadata?.entity_name && (
                        <p className="text-xs text-gray-500 mt-1">{qr.metadata.entity_name}</p>
                      )}
                    </div>
                    {qr.qr_variant && (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        Variant {qr.qr_variant}
                      </span>
                    )}
                  </div>
                  {qr.qr_image && (
                    <div className="mt-4">
                      <img src={qr.qr_image} alt="QR Code" className="w-32 h-32" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <QRCodeAnalyticsView qrCodes={qrCodes} />
        </TabsContent>
      </Tabs>

      {showCreate && (
        <CreateQRView
          open={showCreate}
          onClose={() => {
            setShowCreate(false);
            loadQRCodes();
          }}
        />
      )}
    </div>
  );
}

