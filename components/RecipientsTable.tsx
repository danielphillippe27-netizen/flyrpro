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

interface Recipient {
  id: string;
  address_line: string;
  city: string;
  region: string;
  postal_code: string;
  status: string;
  qr_png_url: string | null;
  sent_at: string | null;
  scanned_at: string | null;
}

interface RecipientsTableProps {
  recipients: Recipient[];
  campaignId: string;
}

export function RecipientsTable({ recipients }: RecipientsTableProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const handleMarkSent = async (recipientId: string) => {
    setLoading(recipientId);
    try {
      const { error } = await supabase
        .from('campaign_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', recipientId);

      if (error) throw error;
      router.refresh();
    } catch (error) {
      console.error('Error marking as sent:', error);
      alert('Failed to update status');
    } finally {
      setLoading(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-gray-200 text-gray-800';
      case 'sent':
        return 'bg-red-200 dark:bg-red-900/30 text-red-800 dark:text-red-300';
      case 'scanned':
        return 'bg-green-200 text-green-800';
      default:
        return 'bg-gray-200 text-gray-800';
    }
  };

  if (recipients.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No recipients yet. Upload a CSV to get started.
      </div>
    );
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Address</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Postal Code</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recipients.map((recipient) => (
            <TableRow key={recipient.id}>
              <TableCell className="font-medium">{recipient.address_line}</TableCell>
              <TableCell>{recipient.city}</TableCell>
              <TableCell>{recipient.region}</TableCell>
              <TableCell>{recipient.postal_code}</TableCell>
              <TableCell>
                <Badge className={getStatusColor(recipient.status)} variant="secondary">
                  {recipient.status}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2">
                {recipient.status === 'pending' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleMarkSent(recipient.id)}
                    disabled={loading === recipient.id}
                  >
                    {loading === recipient.id ? 'Updating...' : 'Mark Sent'}
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

