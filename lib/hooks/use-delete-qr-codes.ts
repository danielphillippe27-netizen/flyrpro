/**
 * React Hook for Deleting QR Codes
 * 
 * Usage:
 * const { deleteQRCodes, isDeleting, result, error } = useDeleteQRCodes();
 * 
 * await deleteQRCodes({ campaignId: 'uuid' });
 */

import { useState, useCallback } from 'react';

interface DeleteParams {
  campaignId: string;
  deleteFromS3?: boolean;
}

interface DeleteResult {
  success: boolean;
  message: string;
  results: {
    addressesCleared: number;
    qrCodesDeleted: number;
    s3Deleted: number;
    errors: string[];
  };
}

export function useDeleteQRCodes() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [result, setResult] = useState<DeleteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deleteQRCodes = useCallback(async (params: DeleteParams): Promise<DeleteResult | null> => {
    setIsDeleting(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/qr/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      setResult(data);
      return data;
    } catch (err: any) {
      const message = err.message || 'Failed to delete QR codes';
      setError(message);
      return null;
    } finally {
      setIsDeleting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setIsDeleting(false);
    setResult(null);
    setError(null);
  }, []);

  return {
    deleteQRCodes,
    reset,
    isDeleting,
    result,
    error,
  };
}
