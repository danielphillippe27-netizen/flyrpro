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

interface NonTrackableExportModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Modal shown when user confirms non-trackable export
 */
export function NonTrackableExportModal({ open, onClose, onConfirm }: NonTrackableExportModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export as non-trackable flyer?</DialogTitle>
          <DialogDescription className="pt-2">
            This flyer will not include QR tracking. You won't see scans, address attribution, or performance analytics for this batch in your dashboard.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Go back
          </Button>
          <Button onClick={onConfirm}>
            Export without tracking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}




