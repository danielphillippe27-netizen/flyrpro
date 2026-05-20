'use client';

import type { Contact } from '@/types/database';
import type { UserStats } from '@/types/database';
import type { IndustryCopy } from '@/lib/industry-copy';
import { StatCard } from '@/components/stats/StatCard';
import { Badge } from '@/components/ui/badge';
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
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
  contactListLabelsById,
  selectedContactIds,
  allVisibleSelected,
  onToggleContactSelection,
  onToggleSelectAll,
  copy,
}: {
  contacts: Contact[];
  userStats: UserStats | null;
  loading: boolean;
  onContactSelect: (contact: Contact) => void;
  contactListLabelsById: Record<string, string[]>;
  selectedContactIds: string[];
  allVisibleSelected: boolean;
  onToggleContactSelection: (contactId: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  copy: IndustryCopy;
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

  const conversationToLeadRate = formatPercent(conversationToLeadRaw ?? 0);
  const knockToConversationRate = formatPercent(knockToConversationRaw ?? 0);

  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={copy.leads.totalLabel} value={loading ? '…' : totalLeads} />
        <StatCard label={copy.leads.newThisWeekLabel} value={loading ? '…' : newThisWeek} />
        <StatCard label={copy.leads.conversionRateLabel} value={loading ? '…' : conversationToLeadRate} />
        <StatCard label="Knock-to-conversation rate" value={loading ? '…' : knockToConversationRate} />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">{copy.leads.loading}</div>
        ) : contacts.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{copy.leads.empty}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <input
                    type="checkbox"
                    aria-label={copy.leads.selectAllAria}
                    checked={allVisibleSelected}
                    onChange={(event) => onToggleSelectAll(event.target.checked)}
                    className="h-4 w-4 rounded border-border align-middle"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Lists</TableHead>
                <TableHead>Last Contacted</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="cursor-pointer"
                  onClick={() => onContactSelect(contact)}
                >
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${contact.full_name}`}
                      checked={selectedContactIds.includes(contact.id)}
                      onChange={(event) => onToggleContactSelection(contact.id, event.target.checked)}
                      className="h-4 w-4 rounded border-border align-middle"
                    />
                  </TableCell>
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
                  <TableCell className="max-w-[260px]">
                    <div className="flex flex-wrap gap-1.5">
                      {(contactListLabelsById[contact.id] ?? []).length > 0 ? (
                        (contactListLabelsById[contact.id] ?? []).map((label) => (
                          <Badge key={`${contact.id}-${label}`} variant="outline" className="rounded-full px-2 py-0 text-[11px]">
                            {label}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatDateTime(contact.last_contacted)}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatCreatedAt(contact.created_at)}
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
