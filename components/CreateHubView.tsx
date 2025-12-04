'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Megaphone, MapPin, QrCode, FileText, FileImage } from 'lucide-react';

export function CreateHubView({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const handleCreate = (
    type: 'campaign' | 'farm' | 'qr' | 'landing-page' | 'flyer'
  ) => {
    onClose();
    if (type === 'campaign') {
      router.push('/campaigns/create');
    } else if (type === 'farm') {
      router.push('/farms/create');
    } else if (type === 'qr') {
      router.push('/qr');
    } else if (type === 'landing-page') {
      // TODO: Create landing page creation route
      router.push('/landing-pages/create');
    } else if (type === 'flyer') {
      router.push('/flyers/editor/new');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New</DialogTitle>
          <DialogDescription>
            Choose what you'd like to create
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid grid-cols-2 gap-4 py-4">
          {/* Left Column */}
          <div className="space-y-4">
            <Button
              variant="outline"
              className="h-auto p-6 flex flex-col items-start w-full"
              onClick={() => handleCreate('campaign')}
            >
              <div className="flex items-center gap-3 mb-2">
                <Megaphone className="w-6 h-6" />
                <span className="text-lg font-semibold">Campaign</span>
              </div>
              <p className="text-sm text-gray-600 text-left">
                Create a new flyer distribution or door-knocking campaign
              </p>
            </Button>

            <Button
              variant="outline"
              className="h-auto p-6 flex flex-col items-start w-full"
              onClick={() => handleCreate('farm')}
            >
              <div className="flex items-center gap-3 mb-2">
                <MapPin className="w-6 h-6" />
                <span className="text-lg font-semibold">Farm</span>
              </div>
              <p className="text-sm text-gray-600 text-left">
                Define a territory for repeated touches
              </p>
            </Button>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            <Button
              variant="outline"
              className="h-auto p-6 flex flex-col items-start w-full"
              onClick={() => handleCreate('flyer')}
            >
              <div className="flex items-center gap-3 mb-2">
                <FileImage className="w-6 h-6" />
                <span className="text-lg font-semibold">Flyer</span>
              </div>
              <p className="text-sm text-gray-600 text-left">
                Design and customize flyer templates for print
              </p>
            </Button>

            <Button
              variant="outline"
              className="h-auto p-6 flex flex-col items-start w-full"
              onClick={() => handleCreate('landing-page')}
            >
              <div className="flex items-center gap-3 mb-2">
                <FileText className="w-6 h-6" />
                <span className="text-lg font-semibold">Landing Page</span>
              </div>
              <p className="text-sm text-gray-600 text-left">
                Create a custom landing page for your campaigns
              </p>
            </Button>

            <Button
              variant="outline"
              className="h-auto p-6 flex flex-col items-start w-full"
              onClick={() => handleCreate('qr')}
            >
              <div className="flex items-center gap-3 mb-2">
                <QrCode className="w-6 h-6" />
                <span className="text-lg font-semibold">QR Code</span>
              </div>
              <p className="text-sm text-gray-600 text-left">
                Generate QR codes for campaigns and tracking
              </p>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

