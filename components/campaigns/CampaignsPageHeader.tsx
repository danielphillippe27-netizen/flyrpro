'use client';

import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CampaignsPageHeaderProps {
  title: string;
}

export function CampaignsPageHeader({ title }: CampaignsPageHeaderProps) {
  const router = useRouter();

  return (
    <header className="shrink-0 bg-card border-b border-border sticky top-0 z-10">
      <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-2.5">
        <h1 className="text-lg font-semibold text-foreground truncate min-w-0">
          {title}
        </h1>
        <Button
          size="sm"
          onClick={() => router.push('/campaigns/create')}
          className="shrink-0 bg-red-500 hover:bg-red-600 text-white"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Create Campaign
        </Button>
      </div>
    </header>
  );
}
