'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChallengeStatusBadge } from '@/components/challenges/ChallengeStatusBadge';
import type { ChallengeInstance, ChallengeTemplate } from '@/types/challenges';
import { cardStatusForTemplate } from '@/lib/challenges/status';
import { templateTimeframeLabel } from '@/lib/challenges/timeframe';
import { cn } from '@/lib/utils';

function ctaForCard(
  template: ChallengeTemplate,
  viewerInstance: ChallengeInstance | null | undefined
): { label: string; href: string; variant: 'default' | 'outline' | 'secondary' } {
  const status = cardStatusForTemplate(template, viewerInstance ?? null);
  const href = `/challenges/${encodeURIComponent(template.slug ?? template.id)}`;

  if (status === 'upcoming') {
    return { label: 'Join Now', href, variant: 'default' };
  }
  if (status === 'completed' || status === 'archived') {
    return { label: 'View Results', href, variant: 'outline' };
  }
  return { label: 'View Challenge', href, variant: 'default' };
}

export function ChallengeCard({
  template,
  viewerInstance,
  viewerSummaryLine,
  className,
}: {
  template: ChallengeTemplate;
  viewerInstance?: ChallengeInstance | null;
  viewerSummaryLine?: string | null;
  className?: string;
}) {
  const status = cardStatusForTemplate(template, viewerInstance ?? null);
  const cta = ctaForCard(template, viewerInstance);
  const timeframe = templateTimeframeLabel(template);

  return (
    <Card className={cn('border-border/60 shadow-sm transition-shadow hover:shadow-md', className)}>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground leading-snug truncate">{template.title}</h3>
            <CardDescription className="mt-1 line-clamp-2">{template.description}</CardDescription>
          </div>
          <ChallengeStatusBadge status={status} className="shrink-0" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{timeframe}</span>
          <span>
            {template.participantCount.toLocaleString()}{' '}
            {template.participantCount === 1 ? 'participant' : 'participants'}
          </span>
        </div>
        {viewerSummaryLine ? (
          <p className="text-xs text-muted-foreground">{viewerSummaryLine}</p>
        ) : null}
        <Button asChild size="sm" variant={cta.variant} className="w-full sm:w-auto">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
