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
import { ratePercent } from '@/lib/stats/formatters';

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
  const totalLeads = contacts.length;
  const weekStart = startOfWeek(new Date()).getTime();
  const newThisWeek = contacts.filter((c) => new Date(c.created_at).getTime() >= weekStart).length;

  const avgLeadsPerConversation =
    userStats && userStats.conversations > 0
      ? `${(ratePercent(userStats.conversation_lead_rate) / 100).toFixed(2)}`
      : '—';
  const leadsPerKnock =
    userStats && userStats.doors_knocked > 0
      ? (userStats.leads_created / userStats.doors_knocked).toFixed(2)
      : '—';

  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total leads" value={loading ? '…' : totalLeads} />
        <StatCard label="New leads this week" value={loading ? '…' : newThisWeek} />
        <StatCard label="Avg. leads per conversation" value={loading ? '…' : avgLeadsPerConversation} />
        <StatCard label="Leads per knock" value={loading ? '…' : leadsPerKnock} />
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
