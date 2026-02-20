'use client';

import Link from 'next/link';
import { Route, Target, MapPin, Plus, type LucideIcon } from 'lucide-react';
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
  /** If set, show "Continue Route" linking to this campaign's route tab; else "Start a Route" to /campaigns */
  activeRouteCampaignId: string | null;
  onCreateCampaign?: () => void;
  canCreateCampaign?: boolean;
}

export function QuickActionsRow({
  activeRouteCampaignId,
  onCreateCampaign,
  canCreateCampaign = true,
}: QuickActionsRowProps) {
  const routeHref = activeRouteCampaignId
    ? `/campaigns/${activeRouteCampaignId}?tab=route`
    : '/campaigns';

  const tiles: QuickActionTile[] = [
    {
      label: activeRouteCampaignId ? 'Continue Route' : 'Start a Route',
      href: routeHref,
      icon: Route,
      ariaLabel: activeRouteCampaignId ? 'Continue current route' : 'Start a route',
    },
    {
      label: 'My Campaigns',
      href: '/campaigns',
      icon: Target,
      ariaLabel: 'View my campaigns',
    },
    {
      label: 'My Routes',
      href: '/campaigns',
      icon: MapPin,
      ariaLabel: 'View routes',
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
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
