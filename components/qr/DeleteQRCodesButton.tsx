/**
 * Delete QR Codes Button Component
 * 
 * A button with confirmation dialog to delete all QR codes for a campaign.
 * After deletion, the generate button will work again.
 */

'use client';

import { useState } from 'react';
import { useDeleteQRCodes } from '@/lib/hooks/use-delete-qr-codes';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Trash2, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';

interface DeleteQRCodesButtonProps {
  campaignId: string;
  onDeleted?: () => void;
  variant?: 'default' | 'outline' | 'destructive';
  size?: 'default' | 'sm' | 'lg';
}

export function DeleteQRCodesButton({
  campaignId,
  onDeleted,
  variant = 'outline',
  size = 'default',
}: DeleteQRCodesButtonProps) {
  const { deleteQRCodes, isDeleting, result, error, reset } = useDeleteQRCodes();
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleDelete = async () => {
    const result = await deleteQRCodes({ campaignId });
    
    if (result) {
      onDeleted?.();
      // Keep dialog open to show results
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 3000);
    }
  };

  const handleClose = () => {
    setOpen(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete QR Codes
        </Button>
      </DialogTrigger>
      
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {result ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            )}
            {result ? 'QR Codes Deleted' : 'Delete QR Codes?'}
          </DialogTitle>
          
          <DialogDescription>
            {!result && (
              <>
                This will delete all QR codes for this campaign ({campaignId.slice(0, 8)}...).
                <br /><br />
                <strong>This action cannot be undone.</strong>
                <br /><br />
                After deletion, you can generate new QR codes.
              </>
            )}
            
            {result && (
              <>
                <div className="mt-2 space-y-1">
                  <p>✓ {result.results.addressesCleared} addresses cleared</p>
                  {result.results.qrCodesDeleted > 0 && (
                    <p>✓ {result.results.qrCodesDeleted} QR records deleted</p>
                  )}
                  {result.results.s3Deleted > 0 && (
                    <p>✓ {result.results.s3Deleted} S3 files deleted</p>
                  )}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  You can now generate new QR codes.
                </p>
              </>
            )}
            
            {error && (
              <div className="mt-2 text-red-600">
                Error: {error}
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Show detailed errors if any */}
        {result?.results.errors && result.results.errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm">
            <p className="font-medium text-red-800 mb-1">Errors encountered:</p>
            <ul className="list-disc list-inside text-red-700 space-y-1">
              {result.results.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Toggle for additional info */}
        {!result && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            {showDetails ? 'Hide' : 'Show'} what will be deleted
          </button>
        )}
        
        {showDetails && !result && (
          <div className="text-xs text-muted-foreground bg-muted p-3 rounded space-y-1">
            <p>• qr_code_base64 from campaign_addresses</p>
            <p>• purl (tracking URLs)</p>
            <p>• QR code records from qr_codes table</p>
            <p>• Canva QR metadata</p>
            <p className="text-amber-600">• S3 files are NOT deleted by default</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {!result ? (
            <>
              <Button variant="outline" onClick={handleClose} disabled={isDeleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete All QR Codes
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteQRCodesButton;
