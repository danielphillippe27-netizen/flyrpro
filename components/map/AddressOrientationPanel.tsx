'use client';

import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import type { CampaignAddress } from '@/types/database';

interface AddressOrientationPanelProps {
  address: CampaignAddress | null;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function AddressOrientationPanel({
  address,
  open,
  onClose,
  onUpdate,
}: AddressOrientationPanelProps) {
  const [bearing, setBearing] = useState(0);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  // Update bearing when address changes
  useEffect(() => {
    if (address) {
      setBearing(address.house_bearing || 0);
    }
  }, [address]);

  const handleSave = async () => {
    if (!address || saving) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('campaign_addresses')
        .update({
          house_bearing: bearing,
          orientation_locked: true, // Lock after manual adjustment
        })
        .eq('id', address.id);

      if (error) throw error;

      // Trigger map refresh
      if (onUpdate) {
        onUpdate();
      }

      onClose();
    } catch (error) {
      console.error('Error saving orientation:', error);
      alert('Failed to save orientation. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!address) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:w-[400px]">
        <SheetHeader>
          <SheetTitle>Adjust House Orientation</SheetTitle>
          <SheetDescription>
            Rotate the house marker to face the desired direction
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div>
            <Label className="text-sm font-medium">Address</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {address.address || address.formatted || 'Unknown address'}
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="bearing-slider">Rotation (degrees)</Label>
                <span className="text-sm font-mono text-muted-foreground">
                  {Math.round(bearing)}°
                </span>
              </div>
              <Slider
                id="bearing-slider"
                min={0}
                max={360}
                step={1}
                value={[bearing]}
                onValueChange={(value) => setBearing(value[0])}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0°</span>
                <span>90°</span>
                <span>180°</span>
                <span>270°</span>
                <span>360°</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBearing((prev) => (prev - 45 + 360) % 360)}
              >
                -45°
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBearing((prev) => (prev + 45) % 360)}
              >
                +45°
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBearing(0)}
              >
                Reset
              </Button>
            </div>
          </div>

          <div className="pt-4 border-t">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full"
            >
              {saving ? 'Saving...' : 'Save Orientation'}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              This will lock the orientation to prevent automatic recalculation.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}


