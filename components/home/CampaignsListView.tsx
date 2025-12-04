'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CampaignsService } from '@/lib/services/CampaignsService';
import type { CampaignV2 } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface CampaignsListViewProps {
  userId: string | null;
  onCampaignSelect?: (campaignId: string) => void;
}

export function CampaignsListView({ userId, onCampaignSelect }: CampaignsListViewProps) {
  const [campaigns, setCampaigns] = useState<CampaignV2[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const loadCampaigns = async () => {
      try {
        const data = await CampaignsService.fetchCampaignsV2(userId);
        setCampaigns(data);
      } catch (error) {
        console.error('Error loading campaigns:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCampaigns();
  }, [userId]);

  if (loading) {
    return <div className="text-center py-8 text-gray-600 dark:text-gray-400">Loading campaigns...</div>;
  }

  if (!userId) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 dark:text-gray-400 mb-4">Please sign in to view campaigns</p>
        <Link href="/login" className="text-red-600 dark:text-red-500 hover:underline text-sm">
          Sign in
        </Link>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 dark:text-gray-400 mb-4">No campaigns yet</p>
        <p className="text-sm text-gray-500 dark:text-gray-500">Create your first campaign to get started</p>
      </div>
    );
  }

  const handleClick = (e: React.MouseEvent, campaignId: string) => {
    if (onCampaignSelect) {
      e.preventDefault();
      e.stopPropagation();
      onCampaignSelect(campaignId);
    }
  };

  return (
    <div className="grid gap-4">
      {campaigns.map((campaign) => (
        <Link 
          key={campaign.id} 
          href={`/campaigns/${campaign.id}`}
          onClick={(e) => handleClick(e, campaign.id)}
        >
          <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-lg">{campaign.name || 'Unnamed Campaign'}</h3>
              <Badge variant={campaign.status === 'active' ? 'default' : 'secondary'}>
                {campaign.status || 'draft'}
              </Badge>
            </div>
            {campaign.type && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {(campaign.type || '').replace('_', ' ')}
              </p>
            )}
            {campaign.total_flyers > 0 && (
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600 dark:text-gray-400">Progress</span>
                  <span className="font-medium dark:text-gray-300">{campaign.progress_pct || 0}%</span>
                </div>
                <Progress value={campaign.progress_pct || 0} className="h-2" />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-500 mt-1">
                  <span>{campaign.scans || 0} scans</span>
                  <span>{campaign.total_flyers} total</span>
                </div>
              </div>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
}

