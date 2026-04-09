'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type AccountabilityPost = {
  id: string;
  iso_week: string;
  week_start: string;
  doors_this_week: number;
  conversations_this_week: number;
  appointments_this_week: number;
  next_week_goal: number;
  card_public_url: string;
};

export function WeeklyAccountabilityBanner() {
  const [post, setPost] = useState<AccountabilityPost | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const response = await fetch('/api/accountability-card/latest', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (!cancelled) {
        setPost(payload?.post ?? null);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!post || dismissed) {
    return null;
  }

  async function markPosted() {
    setBusy(true);
    try {
      await fetch('/api/accountability-card/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: post.id }),
      });
      setDismissed(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    setBusy(true);
    try {
      const response = await fetch(post.card_public_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `flyr-weekly-accountability-${post.iso_week}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden border-border/70 bg-card/95">
      <CardContent className="p-0">
        <div className="grid gap-0 md:grid-cols-[220px_1fr]">
          <div className="border-b border-border/60 bg-black md:border-b-0 md:border-r">
            <img
              src={post.card_public_url}
              alt="Weekly accountability card preview"
              className="block aspect-[9/16] w-full object-cover"
            />
          </div>
          <div className="space-y-4 p-5">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-500">
                Weekly Accountability
              </p>
              <h3 className="text-lg font-semibold text-foreground">
                Your recap card is ready to post
              </h3>
              <p className="text-sm text-muted-foreground">
                {post.doors_this_week} doors, {post.conversations_this_week} conversations, {post.appointments_this_week} appointments.
                Next week&apos;s goal is {post.next_week_goal} doors.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleDownload} disabled={busy}>
                Download
              </Button>
              <Button type="button" variant="outline" onClick={markPosted} disabled={busy}>
                Mark posted
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDismissed(true)} disabled={busy}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
