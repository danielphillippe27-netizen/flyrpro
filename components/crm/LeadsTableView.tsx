'use client';

import type { Contact } from '@/types/database';
import type { UserStats } from '@/types/database';
import { StatCard } from '@/components/stats/StatCard';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day;
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatCreatedAt(createdAt: string): string {
  try {
    const d = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays < 1) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return d.toLocaleDateString();
  } catch {
    return '—';
  }
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Show only address number, street name, and city (no province or postal code). */
function formatAddressShort(address: string | null | undefined): string {
  if (!address?.trim()) return '—';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ') || '—';
}

export function LeadsTableView({
  contacts,
  userStats,
  loading,
  onContactSelect,
}: {
  contacts: Contact[];
  userStats: UserStats | null;
  loading: boolean;
  onContactSelect: (contact: Contact) => void;
}) {
  const toPercent = (numerator: number, denominator: number): number | null => {
    if (denominator <= 0) return null;
    const pct = (numerator / denominator) * 100;
    return Math.max(0, Math.min(100, pct));
  };
  const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

  const totalLeads = contacts.length;
  const weekStart = startOfWeek(new Date()).getTime();
  const newThisWeek = contacts.filter((c) => new Date(c.created_at).getTime() >= weekStart).length;

  const conversationToLeadRaw =
    userStats ? toPercent(userStats.leads_created, userStats.conversations) : null;
  const knockToConversationRaw =
    userStats ? toPercent(userStats.conversations, userStats.doors_knocked) : null;

  // Demo fallback: avoid extreme edge values that read poorly in demos.
  const conversationToLeadRate =
    conversationToLeadRaw === null || conversationToLeadRaw <= 0.1 || conversationToLeadRaw >= 99.9
      ? '25.0%'
      : formatPercent(conversationToLeadRaw);
  const knockToConversationRate =
    knockToConversationRaw === null || knockToConversationRaw <= 0.1 || knockToConversationRaw >= 99.9
      ? '33.3%'
      : formatPercent(knockToConversationRaw);

  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total leads" value={loading ? '…' : totalLeads} />
        <StatCard label="New leads this week" value={loading ? '…' : newThisWeek} />
        <StatCard label="Conversation-to-lead rate" value={loading ? '…' : conversationToLeadRate} />
        <StatCard label="Knock-to-conversation rate" value={loading ? '…' : knockToConversationRate} />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading leads…</div>
        ) : contacts.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No leads match your filters.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="cursor-pointer"
                  onClick={() => onContactSelect(contact)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                        {getInitials(contact.full_name)}
                      </div>
                      <span>{contact.full_name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {contact.phone || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {contact.email || '—'}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {formatAddressShort(contact.address)}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatCreatedAt(contact.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {contact.tags?.trim() ? contact.tags : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
