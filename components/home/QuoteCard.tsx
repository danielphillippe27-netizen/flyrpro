'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Quote } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DailyContent {
  quote: {
    text: string;
    author: string;
    category: string;
  };
}

interface QuoteCardProps {
  className?: string;
  /** When true, render quote content without a card (same size area, no border/background) */
  noCard?: boolean;
}

export function QuoteCard({ className, noCard }: QuoteCardProps) {
  const [content, setContent] = useState<DailyContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDailyContent();
  }, []);

  const fetchDailyContent = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/daily-content');
      if (!response.ok) {
        throw new Error('Failed to fetch daily content');
      }
      
      const data = await response.json();
      if (data.success) {
        setContent(data);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Error fetching daily content:', err);
      setError('Could not load daily inspiration');
    } finally {
      setLoading(false);
    }
  };

  const contentPadding = 'p-6 md:p-8';
  const minHeightClass = noCard ? 'flex flex-col justify-center' : '';

  if (loading) {
    const wrapper = noCard ? (
      <div className={cn('w-full', contentPadding, minHeightClass, className)}>
        <div className="space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    ) : (
      <Card className="rounded-xl border border-border overflow-hidden">
        <CardContent className={contentPadding}>
          <div className="space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full max-w-xl" />
            <Skeleton className="h-4 w-32" />
          </div>
        </CardContent>
      </Card>
    );
    return <div className={cn('w-full', !noCard && className)}>{wrapper}</div>;
  }

  if (error || !content) {
    const wrapper = noCard ? (
      <div className={cn('w-full', contentPadding, minHeightClass, 'text-center', className)}>
        <Quote className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{error || 'No content available'}</p>
      </div>
    ) : (
      <Card className="rounded-xl border border-border overflow-hidden">
        <CardContent className={contentPadding + ' text-center'}>
          <Quote className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{error || 'No content available'}</p>
        </CardContent>
      </Card>
    );
    return <div className={cn('w-full', !noCard && className)}>{wrapper}</div>;
  }

  const { quote } = content;

  const inner = (
    <div className={cn('flex items-start gap-4', contentPadding, noCard && minHeightClass)}>
      <div className="flex-shrink-0">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Quote className="w-6 h-6 text-primary" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted-foreground mb-2">
          Quote of the Day
        </p>
        <blockquote className="text-xl md:text-2xl font-medium text-foreground leading-snug mb-4">
          &quot;{quote.text}&quot;
        </blockquote>
        <cite className="text-base text-muted-foreground not-italic">
          — {quote.author}
        </cite>
      </div>
    </div>
  );

  if (noCard) {
    return (
      <div className={cn('w-full', className)}>
        {inner}
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)}>
      <Card className="rounded-xl border border-border overflow-hidden bg-gradient-to-br from-card to-card/95">
        <CardContent className="p-0">
          {inner}
        </CardContent>
      </Card>
    </div>
  );
}
