'use client';
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ChallengeShareCardModal({
  open,
  onOpenChange,
  userId,
  challengeId,
  sessionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  challengeId: string;
  sessionId: string | null;
}) {
  const [isDownloading, setIsDownloading] = useState(false);

  const imageUrl = useMemo(() => {
    if (!sessionId) return null;
    const params = new URLSearchParams({
      user_id: userId,
      challenge_id: challengeId,
      session_id: sessionId,
    });
    return `/api/share-card?${params.toString()}`;
  }, [challengeId, sessionId, userId]);

  async function withImageBlob(action: (blob: Blob) => Promise<void>) {
    if (!imageUrl) return;
    setIsDownloading(true);
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      await action(blob);
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleDownload() {
    await withImageBlob(async (blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `flyr-share-card-${sessionId ?? 'session'}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }

  async function handleCopy() {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      await handleDownload();
      return;
    }

    await withImageBlob(async (blob) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type || 'image/png']: blob,
        }),
      ]);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] border-border/70 bg-card/95">
        <DialogHeader>
          <DialogTitle>Share your progress</DialogTitle>
          <DialogDescription>
            A story-sized card for iMessage, X, and Instagram stories.
          </DialogDescription>
        </DialogHeader>

        {imageUrl ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-black">
              <img
                alt="WolfGrid share card preview"
                src={imageUrl}
                className="block h-auto w-full"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={handleCopy} disabled={isDownloading}>
                Copy image
              </Button>
              <Button type="button" className="flex-1" onClick={handleDownload} disabled={isDownloading}>
                Download
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            Finish a session to generate a share card.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
