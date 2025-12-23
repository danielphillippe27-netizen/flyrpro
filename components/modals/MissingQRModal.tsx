'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface MissingQRModalProps {
  open: boolean;
  onClose: () => void;
  onAddQR: () => void;
}

/**
 * Modal shown when a user tries to export a trackable campaign without a QR element
 */
export function MissingQRModal({ open, onClose, onAddQR }: MissingQRModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This campaign is missing a QR code</DialogTitle>
          <DialogDescription className="pt-2">
            A QR is required to track scans by address. We can automatically insert a QR into your flyer layout so you can see which homes engaged with your campaign.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onAddQR}>
            Add QR automatically
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}




