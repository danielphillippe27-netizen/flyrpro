'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FarmService } from '@/lib/services/FarmService';
import type { Farm } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/lib/workspace-context';
import {
  formatFarmBudget,
  formatFarmCadence,
  formatFarmTouchTypeLabel,
  normalizeFarmTouchTypes,
} from '@/lib/farms/config';

export function FarmListView({ userId }: { userId: string | null }) {
  const { currentWorkspaceId } = useWorkspace();
  const [farms, setFarms] = useState<Farm[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const loadFarms = async () => {
      try {
        const data = await FarmService.fetchFarms(userId, currentWorkspaceId);
        setFarms(data);
      } catch (error) {
        console.error('Error loading farms:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFarms();
  }, [userId, currentWorkspaceId]);

  if (loading) {
    return <div className="text-center py-8 text-gray-600 dark:text-gray-400">Loading farms...</div>;
  }

  if (!userId) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 dark:text-gray-400 mb-4">Please sign in to view farms</p>
        <Link href="/login" className="text-red-600 dark:text-red-500 hover:underline text-sm">
          Sign in
        </Link>
      </div>
    );
  }

  if (farms.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 dark:text-gray-400 mb-4">No farms yet</p>
        <p className="text-sm text-gray-500 dark:text-gray-500">Create a farm territory to get started</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {farms.map((farm) => (
        <Link key={farm.id} href={`/farms/${farm.id}`}>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-lg">{farm.name}</h3>
              <Badge variant={farm.is_active ? 'default' : 'secondary'}>
                {farm.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            {farm.area_label && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{farm.area_label}</p>
            )}
            <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-500 mt-2">
              <div className="flex justify-between gap-3">
                <span>{formatFarmCadence(farm)}</span>
                <span>{(farm.address_count ?? 0).toLocaleString()} homes</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="truncate">
                  {normalizeFarmTouchTypes(farm.touch_types).map(formatFarmTouchTypeLabel).join(', ') || 'No touch types'}
                </span>
                <span>{formatFarmBudget(farm.annual_budget_cents) || 'No budget'}</span>
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

