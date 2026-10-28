'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DismissibleCampaignBanner({
  storageKey,
  noticeId,
  label,
  className,
  children,
}: {
  storageKey: string;
  noticeId: string;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const identity = JSON.stringify([storageKey, noticeId]);

  useEffect(() => {
    try {
      setDismissedNotice(window.localStorage.getItem(storageKey) === noticeId ? identity : null);
    } catch {
      // Dismissal still works for this visit when browser storage is unavailable.
    }
  }, [storageKey, noticeId, identity]);

  if (dismissedNotice === identity) return null;

  return (
    <div role="status" className={`relative pr-14 ${className}`}>
      {children}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-2 top-2"
        aria-label={label}
        title={label}
        onClick={() => {
          setDismissedNotice(identity);
          try {
            window.localStorage.setItem(storageKey, noticeId);
          } catch {
            // Keep the banner hidden even if storage is blocked or full.
          }
        }}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
