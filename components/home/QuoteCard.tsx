'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Quote, Brain, ChevronDown, ChevronUp, Lightbulb, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DailyContent {
  quote: {
    text: string;
    author: string;
    category: string;
  };
  riddle: {
    question: string;
    answer: string;
    difficulty: string;
  };
}

interface QuoteCardProps {
  className?: string;
}

export function QuoteCard({ className }: QuoteCardProps) {
  const [content, setContent] = useState<DailyContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);
  const [userGotIt, setUserGotIt] = useState<boolean | null>(null);
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

  const handleUserResponse = (gotIt: boolean) => {
    setUserGotIt(gotIt);
  };

  if (loading) {
    return (
      <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-4', className)}>
        <Card className="rounded-xl border border-border overflow-hidden">
          <CardContent className="p-6">
            <div className="space-y-4">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border overflow-hidden">
          <CardContent className="p-6">
            <div className="space-y-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-12 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-4', className)}>
        <Card className="rounded-xl border border-border overflow-hidden">
          <CardContent className="p-6 text-center">
            <Quote className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{error || 'No content available'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { quote, riddle } = content;

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-4', className)}>
      {/* Quote of the Day card */}
      <Card className="rounded-xl border border-border overflow-hidden bg-gradient-to-br from-card to-card/95">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Quote className="w-5 h-5 text-primary" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-muted-foreground mb-1">
                Quote of the Day
              </p>
              <blockquote className="text-base text-foreground leading-relaxed mb-3">
                "{quote.text}"
              </blockquote>
              <cite className="text-sm text-muted-foreground not-italic">
                — {quote.author}
              </cite>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Brain boost card - always show daily riddle */}
      <Card className="rounded-xl border border-border overflow-hidden bg-gradient-to-br from-card to-card/95">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <span className="font-medium text-foreground">
              Brain boost: daily riddle
              <span className="font-normal text-muted-foreground capitalize ml-1.5">
                {riddle.difficulty}
              </span>
            </span>
          </div>

          <p className="text-base text-foreground mb-4">
            {riddle.question}
          </p>

          {/* Answer dropdown */}
          <div className="border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAnswer(!showAnswer)}
              className="w-full px-4 py-3 flex items-center justify-between text-left text-sm font-medium text-foreground bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <span>Answer</span>
              {showAnswer ? (
                <ChevronUp className="w-4 h-4 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 flex-shrink-0" />
              )}
            </button>
            {showAnswer && (
              <div className="px-4 py-3 border-t border-border bg-muted/20 animate-in slide-in-from-top-1 duration-200">
                <p className="text-base font-medium text-foreground">{riddle.answer}</p>
              </div>
            )}
          </div>

          {showAnswer && (
            <div className="mt-4 space-y-4 animate-in fade-in duration-200">
              {userGotIt === null ? (
                <div className="space-y-2">
                  <p className="text-sm text-center text-muted-foreground">
                    Did you get it?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUserResponse(true)}
                      className="flex-1"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2 text-green-500" />
                      Yes
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUserResponse(false)}
                      className="flex-1"
                    >
                      <XCircle className="w-4 h-4 mr-2 text-red-500" />
                      No
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className={cn(
                    'text-center py-3 rounded-lg',
                    userGotIt
                      ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400'
                      : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                  )}
                >
                  {userGotIt ? (
                    <span className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      Nice work! 🎉
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Lightbulb className="w-5 h-5" />
                      Better luck tomorrow! 💪
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
