'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Quote, Share2, Check } from 'lucide-react';
import { getQuoteForToday } from '@/lib/daily-quotes';

export function DailyQuote() {
  const quote = getQuoteForToday();
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(quote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [quote]);

  return (
    <Card className="h-full flex flex-col rounded-xl border border-border shadow-sm">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-foreground">
            <Quote className="w-4 h-4" />
            <span className="text-sm font-medium">Daily motivation</span>
          </div>
          <button
            type="button"
            onClick={handleShare}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Copy quote"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center min-h-0">
        <p className="text-sm text-foreground/90 italic">&ldquo;{quote}&rdquo;</p>
      </CardContent>
    </Card>
  );
}
