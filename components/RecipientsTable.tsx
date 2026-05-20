'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
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
  /** When true, show "Mark attempted" for addresses without a knock outcome yet. */
  canMarkVisited?: boolean;
  qr_png_url: string | null;
  qr_code_base64?: string | null;  // NEW: Add QR code base64
  sent_at: string | null;
  scanned_at: string | null;
  street_name?: string;
  house_number?: string;
  locality?: string;
  seq?: number;
  contacts?: string[];
}

interface RecipientsTableProps {
  recipients: Recipient[];
  campaignId: string;
  onRefresh?: () => Promise<void> | void;
}

export function RecipientsTable({ recipients, campaignId, onRefresh }: RecipientsTableProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();
  const supabase = createClient();

  const handleMarkSent = async (recipientId: string) => {
    setLoading(recipientId);
    try {
      const { error } = await supabase.rpc('record_campaign_address_outcome', {
        p_campaign_id: campaignId,
        p_campaign_address_id: recipientId,
        p_status: 'no_answer',
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

  const normalizeText = (value: string | null | undefined) =>
    value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

  const getAddressText = (recipient: Recipient) =>
    recipient.house_number && recipient.street_name
      ? `${recipient.house_number} ${recipient.street_name}`
      : recipient.address_line || 'N/A';

  const filteredRecipients = useMemo(() => {
    const query = normalizeText(searchQuery);
    if (!query) return recipients;

    return recipients.filter((recipient) => {
      const searchText = [
        getAddressText(recipient),
        recipient.address_line,
        recipient.city,
        recipient.region,
        recipient.postal_code,
        recipient.locality,
        displayLabel(recipient),
        recipient.contacts?.join(' '),
      ]
        .map(normalizeText)
        .join(' ');

      return searchText.includes(query);
    });
  }, [recipients, searchQuery]);

  const showContactsColumn = recipients.some((recipient) => (recipient.contacts?.length ?? 0) > 0);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'none':
      case 'pending':
        return 'bg-slate-500/15 text-slate-700 dark:text-slate-200 border border-slate-500/30';
      case 'qr_scanned':
        return 'bg-violet-500/15 text-violet-800 dark:text-violet-200 border border-violet-500/30';
      case 'no_answer':
        return 'bg-red-500/15 text-red-800 dark:text-red-200 border border-red-500/30';
      case 'delivered':
        return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border border-emerald-500/25';
      case 'talked':
        return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border border-emerald-500/25';
      case 'do_not_knock':
        return 'bg-black text-white border border-black';
      case 'appointment':
      case 'future_seller':
      case 'hot_lead':
        return 'bg-yellow-400/20 text-yellow-900 dark:text-yellow-200 border border-yellow-400/40';
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
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search addresses, status, or contacts..."
          className="pl-9"
          aria-label="Search addresses"
        />
      </div>

      <div className="border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              {showContactsColumn && <TableHead>Contacts</TableHead>}
              <TableHead>QR Code</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRecipients.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={showContactsColumn ? 5 : 4}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No addresses match your search.
                </TableCell>
              </TableRow>
            ) : (
              filteredRecipients.map((recipient) => {
                const contactsText = recipient.contacts?.join(', ') || '—';

                return (
                  <TableRow key={recipient.id}>
                    <TableCell className="font-medium">{getAddressText(recipient)}</TableCell>
                    {showContactsColumn && (
                      <TableCell className="max-w-[240px] truncate text-muted-foreground" title={contactsText}>
                        {contactsText}
                      </TableCell>
                    )}
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
                          {loading === recipient.id ? 'Updating...' : 'Mark Attempted'}
                        </Button>
                      )}
                      {recipient.qr_code_base64 && (
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => {
                            const blob = new Blob(
                              [Uint8Array.from(atob(recipient.qr_code_base64!), c => c.charCodeAt(0))],
                              { type: 'image/png' }
                            );
                            const url = URL.createObjectURL(blob);
                            window.open(url, '_blank');
                          }}
                        >
                          View QR
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
