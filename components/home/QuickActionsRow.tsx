'use client';

import Link from 'next/link';
import { Target, Plus, Users, Activity, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type QuickActionTile =
  | {
      label: string;
      href: string;
      icon: LucideIcon;
      ariaLabel: string;
    }
  | {
      label: string;
      onClick: () => void;
      icon: LucideIcon;
      ariaLabel: string;
    };

interface QuickActionsRowProps {
  activeRouteCampaignId?: string | null;
  onCreateCampaign?: () => void;
  canCreateCampaign?: boolean;
}

export function QuickActionsRow({
  onCreateCampaign,
  canCreateCampaign = true,
}: QuickActionsRowProps) {
  const tiles: QuickActionTile[] = [
    {
      label: 'My Campaigns',
      href: '/campaigns',
      icon: Target,
      ariaLabel: 'View my campaigns',
    },
    {
      label: 'Leads',
      href: '/leads',
      icon: Users,
      ariaLabel: 'View leads',
    },
    {
      label: 'Activity',
      href: '/activity',
      icon: Activity,
      ariaLabel: 'View activity',
    },
  ];

  if (canCreateCampaign && onCreateCampaign) {
    tiles.push({
      label: 'Create Campaign',
      onClick: onCreateCampaign,
      icon: Plus,
      ariaLabel: 'Create new campaign',
    });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        const content = (
          <>
            <Icon className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{tile.label}</span>
          </>
        );
        const className =
          'flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-muted/50 hover-glow-red transition-colors min-h-[88px]';

        if ('href' in tile) {
          return (
            <Link
              key={tile.label}
              href={tile.href}
              className={cn(className, 'focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring')}
              aria-label={tile.ariaLabel}
            >
              {content}
            </Link>
          );
        }
        return (
          <button
            key={tile.label}
            type="button"
            onClick={tile.onClick}
            className={cn(className, 'text-left w-full cursor-pointer focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring')}
            aria-label={tile.ariaLabel}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
