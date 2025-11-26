'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ContactStatus } from '@/types/database';

export function ContactFiltersView({
  filters,
  onFiltersChange,
}: {
  filters: { status?: ContactStatus; campaignId?: string; farmId?: string };
  onFiltersChange: (filters: { status?: ContactStatus; campaignId?: string; farmId?: string }) => void;
}) {
  return (
    <div className="bg-white rounded-lg border p-4 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Status</label>
          <Select
            value={filters.status || 'all'}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, status: value === 'all' ? undefined : value as ContactStatus })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="hot">Hot</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="cold">Cold</SelectItem>
              <SelectItem value="new">New</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Add campaign and farm filters as needed */}
      </div>
    </div>
  );
}

