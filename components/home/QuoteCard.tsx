'use client';

import { useState, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
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
}

export function QuoteCard({ className }: QuoteCardProps) {
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

  if (loading) {
    return (
      <div className={cn('w-full space-y-3', className)}>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full max-w-4xl" />
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className={cn('w-full', className)}>
        <p className="text-sm text-muted-foreground">{error || 'No content available'}</p>
      </div>
    );
  }

  const { quote } = content;

  return (
    <div className={cn('w-full', className)}>
      <p className="text-sm font-medium text-muted-foreground mb-2">Quote of the Day</p>
      <blockquote className="text-3xl md:text-4xl font-medium text-foreground leading-tight">
        &ldquo;{quote.text}&rdquo;
      </blockquote>
      <cite className="mt-3 block text-base text-muted-foreground not-italic">— {quote.author}</cite>
    </div>
  );
}
