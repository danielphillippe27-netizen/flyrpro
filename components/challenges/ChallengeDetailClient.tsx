'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { ChallengeDetailView } from '@/components/challenges/ChallengeDetailView';
import type {
  ChallengeInstance,
  ChallengeTemplate,
  LeaderboardEntry,
} from '@/types/challenges';

type DetailPayload = {
  viewerUserId: string;
  template: ChallengeTemplate;
  viewerInstance: ChallengeInstance | null;
  leaderboard: LeaderboardEntry[];
  leaderboardLast30Days: LeaderboardEntry[];
  overview: {
    totalParticipants: number;
    averageScore: number;
    topPerformerName: string;
    topPerformerScore: number;
  };
  leaderboardLocked: boolean;
};

export function ChallengeDetailClient({ challengeId }: { challengeId: string }) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<'notfound' | 'other' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    fetch(`/api/challenges/${encodeURIComponent(challengeId)}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 404) {
          setError('notfound');
          return null;
        }
        if (!res.ok) {
          setError('other');
          return null;
        }
        return res.json() as Promise<DetailPayload>;
      })
      .then((json) => {
        if (cancelled || !json) return;
        setData(json);
      })
      .catch(() => {
        if (!cancelled) setError('other');
      });
    return () => {
      cancelled = true;
    };
  }, [challengeId]);

  if (error === 'notfound') {
    notFound();
  }

  if (error === 'other' || (data === null && error === null)) {
    return (
      <div className="min-h-full flex items-center justify-center p-8 text-muted-foreground text-sm">
        {error === 'other' ? 'Could not load challenge.' : 'Loading…'}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <ChallengeDetailView
      viewerUserId={data.viewerUserId}
      template={data.template}
      viewerInstance={data.viewerInstance}
      leaderboard={data.leaderboard}
      leaderboardLast30Days={data.leaderboardLast30Days}
      overview={data.overview}
      leaderboardLocked={data.leaderboardLocked}
    />
  );
}
