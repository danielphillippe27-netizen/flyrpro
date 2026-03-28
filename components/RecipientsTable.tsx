'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Recipient {
  id: string;
  address_line: string;
  city: string;
  region: string;
  postal_code: string;
  /** Canonical outcome key (e.g. none, talked, delivered). */
  status: string;
  /** User-facing label; falls back to title-casing `status` when omitted. */
  statusLabel?: string;
  /** When true, show “Mark visited” for addresses without a knock outcome yet. */
  canMarkVisited?: boolean;
  qr_png_url: string | null;
  qr_code_base64?: string | null;  // NEW: Add QR code base64
  sent_at: string | null;
  scanned_at: string | null;
  street_name?: string;
  house_number?: string;
  locality?: string;
  seq?: number;
}

interface RecipientsTableProps {
  recipients: Recipient[];
  campaignId: string;
  onRefresh?: () => Promise<void> | void;
}

export function RecipientsTable({ recipients, campaignId, onRefresh }: RecipientsTableProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const handleMarkSent = async (recipientId: string) => {
    setLoading(recipientId);
    try {
      const { error } = await supabase.rpc('record_campaign_address_outcome', {
        p_campaign_id: campaignId,
        p_campaign_address_id: recipientId,
        p_status: 'delivered',
        p_notes: '',
        p_occurred_at: new Date().toISOString(),
      });

      if (error) {
        throw error;
      }
      if (onRefresh) {
        await onRefresh();
      } else {
        router.refresh();
      }
    } catch (error) {
      console.error('Error saving house outcome:', error);
      alert('Failed to update status');
    } finally {
      setLoading(null);
    }
  };

  const displayLabel = (recipient: Recipient) =>
    recipient.statusLabel?.trim() ||
    recipient.status
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'none':
      case 'pending':
        return 'bg-muted text-muted-foreground border border-border';
      case 'qr_scanned':
        return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30';
      case 'no_answer':
        return 'bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-500/25';
      case 'delivered':
        return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border border-emerald-500/25';
      case 'talked':
        return 'bg-violet-500/15 text-violet-800 dark:text-violet-200 border border-violet-500/25';
      case 'appointment':
        return 'bg-primary/15 text-primary border border-primary/25';
      case 'do_not_knock':
        return 'bg-destructive/15 text-destructive border border-destructive/25';
      case 'future_seller':
      case 'hot_lead':
        return 'bg-orange-500/15 text-orange-800 dark:text-orange-200 border border-orange-500/25';
      case 'sent':
        return 'bg-red-200 dark:bg-red-900/30 text-red-800 dark:text-red-300';
      case 'scanned':
        return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border border-emerald-500/25';
      default:
        return 'bg-muted text-foreground border border-border';
    }
  };

  if (recipients.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No addresses yet. Create a campaign with addresses or upload a CSV to get started.
      </div>
    );
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Address</TableHead>
            <TableHead>QR Code</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recipients.map((recipient) => (
            <TableRow key={recipient.id}>
              <TableCell className="font-medium">
                {recipient.house_number && recipient.street_name 
                  ? `${recipient.house_number} ${recipient.street_name}`
                  : recipient.address_line || 'N/A'}
              </TableCell>
              <TableCell className="px-6 py-4 whitespace-nowrap">
                {recipient.qr_code_base64 ? (
                  <div className="flex items-center">
                    <img 
                      src={recipient.qr_code_base64} 
                      alt="QR Code" 
                      className="h-12 w-12 border rounded-md"
                    />
                    <a 
                      href={recipient.qr_code_base64} 
                      download={`${recipient.address_line.replace(/[^a-zA-Z0-9]/g, '-')}.png`}
                      className="ml-2 text-blue-600 hover:text-blue-800 text-xs"
                    >
                      ↓
                    </a>
                  </div>
                ) : (
                  <span className="text-gray-400 text-xs italic">Not generated</span>
                )}
              </TableCell>
              <TableCell>
                <Badge className={cn('font-normal', getStatusBadgeClass(recipient.status))} variant="secondary">
                  {displayLabel(recipient)}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2">
                {recipient.canMarkVisited && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleMarkSent(recipient.id)}
                    disabled={loading === recipient.id}
                  >
                    {loading === recipient.id ? 'Updating...' : 'Mark Visited'}
                  </Button>
                )}
                {recipient.qr_png_url && (
                  <Button
                    size="sm"
                    variant="link"
                    asChild
                  >
                    <a href={recipient.qr_png_url} target="_blank" rel="noopener noreferrer">
                      View QR
                    </a>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
