'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useFlyerEditorStore, generateId } from './useFlyerEditorStore';
import { FLYER_PRINT_CONSTANTS } from '@/lib/flyers/printConstants';
import type { FlyerTextElement, FlyerImageElement, FlyerQRElement } from '@/lib/flyers/types';
import { uploadFlyerImage } from '@/lib/flyers/imageUpload';

interface ToolbarProps {
  campaignId: string;
  flyerId: string;
  onExport: () => void;
}

export function Toolbar({ campaignId, flyerId, onExport }: ToolbarProps) {
  const {
    addElement,
    setBackgroundColor,
    flyerData,
  } = useFlyerEditorStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddHeading = () => {
    const element: FlyerTextElement = {
      id: generateId(),
      type: 'text',
      x: FLYER_PRINT_CONSTANTS.SAFE_RECT.x + 100,
      y: FLYER_PRINT_CONSTANTS.SAFE_RECT.y + 100,
      width: FLYER_PRINT_CONSTANTS.SAFE_WIDTH - 200,
      height: 100,
      rotation: 0,
      text: 'New Heading',
      fontFamily: 'Arial',
      fontSize: 48,
      fontWeight: 'bold',
      align: 'center',
      fill: '#000000',
    };
    addElement(element);
  };

  const handleAddBody = () => {
    const element: FlyerTextElement = {
      id: generateId(),
      type: 'text',
      x: FLYER_PRINT_CONSTANTS.SAFE_RECT.x + 100,
      y: FLYER_PRINT_CONSTANTS.SAFE_RECT.y + 250,
      width: FLYER_PRINT_CONSTANTS.SAFE_WIDTH - 200,
      height: 200,
      rotation: 0,
      text: 'Body text goes here',
      fontFamily: 'Arial',
      fontSize: 28,
      fontWeight: 'normal',
      align: 'left',
      fill: '#000000',
    };
    addElement(element);
  };

  const handleAddImage = async () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const imageUrl = await uploadFlyerImage(file, campaignId, flyerId);
      
      const element: FlyerImageElement = {
        id: generateId(),
        type: 'image',
        x: FLYER_PRINT_CONSTANTS.SAFE_RECT.x + (FLYER_PRINT_CONSTANTS.SAFE_WIDTH / 2) - 150,
        y: FLYER_PRINT_CONSTANTS.SAFE_RECT.y + (FLYER_PRINT_CONSTANTS.SAFE_HEIGHT / 2) - 150,
        width: 300,
        height: 300,
        rotation: 0,
        imageUrl,
        objectFit: 'contain',
      };
      addElement(element);
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert(error instanceof Error ? error.message : 'Failed to upload image');
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAddQR = () => {
    const url = prompt('Enter URL for QR code:');
    if (!url) return;

    const qrSize = 200;
    const element: FlyerQRElement = {
      id: generateId(),
      type: 'qr',
      x: FLYER_PRINT_CONSTANTS.SAFE_RECT.x + FLYER_PRINT_CONSTANTS.SAFE_WIDTH - qrSize - 50,
      y: FLYER_PRINT_CONSTANTS.SAFE_RECT.y + FLYER_PRINT_CONSTANTS.SAFE_HEIGHT - qrSize - 50,
      size: qrSize,
      rotation: 0,
      url,
    };
    addElement(element);
  };

  return (
    <div className="w-60 bg-slate-900 border-r border-slate-800 flex flex-col p-4 gap-4">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Add Elements
        </h2>
        <div className="space-y-2">
          <Button
            onClick={handleAddHeading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
            size="sm"
          >
            Add Heading
          </Button>
          <Button
            onClick={handleAddBody}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
            size="sm"
          >
            Add Body Text
          </Button>
          <Button
            onClick={handleAddImage}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
            size="sm"
          >
            Add Image
          </Button>
          <Button
            onClick={handleAddQR}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
            size="sm"
          >
            Add QR Code
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Background
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Color:</label>
          <input
            type="color"
            value={flyerData.backgroundColor}
            onChange={(e) => setBackgroundColor(e.target.value)}
            className="w-16 h-8 rounded cursor-pointer"
          />
        </div>
      </div>

      <div className="mt-auto pt-4 border-t border-slate-800">
        <Button
          onClick={onExport}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium"
          size="sm"
        >
          Export for Print
        </Button>
        <p className="text-xs text-slate-500 mt-2 text-center">
          8.5" × 11" + 0.125" bleed • 300 DPI
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}

