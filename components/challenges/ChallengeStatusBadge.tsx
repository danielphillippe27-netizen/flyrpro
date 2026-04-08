'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type CardStatus = 'upcoming' | 'active' | 'completed' | 'archived';

const LABEL: Record<CardStatus, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

export function ChallengeStatusBadge({
  status,
  className,
}: {
  status: CardStatus;
  className?: string;
}) {
  const variant =
    status === 'active'
      ? 'default'
      : status === 'completed'
        ? 'secondary'
        : status === 'archived'
          ? 'outline'
          : 'outline';

  return (
    <Badge
      variant={variant}
      className={cn(
        'font-medium',
        status === 'active' && 'bg-primary/90',
        status === 'upcoming' && 'text-muted-foreground',
        className
      )}
    >
      {LABEL[status]}
    </Badge>
  );
}
