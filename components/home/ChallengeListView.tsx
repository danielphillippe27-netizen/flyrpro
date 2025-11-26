'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChallengeService } from '@/lib/services/ChallengeService';
import type { Challenge } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export function ChallengeListView({ userId }: { userId: string | null }) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const loadChallenges = async () => {
      try {
        const data = await ChallengeService.fetchActiveChallenges(userId);
        setChallenges(data);
      } catch (error) {
        console.error('Error loading challenges:', error);
      } finally {
        setLoading(false);
      }
    };

    loadChallenges();
  }, [userId]);

  if (loading) {
    return <div className="text-center py-8 text-gray-600">Loading challenges...</div>;
  }

  if (challenges.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">No active challenges</p>
        <p className="text-sm text-gray-500">Create a challenge to track your progress</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {challenges.map((challenge) => (
        <Link key={challenge.id} href={`/challenges/${challenge.id}`}>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-lg">{challenge.title}</h3>
              <Badge variant={challenge.is_completed ? 'default' : 'secondary'}>
                {challenge.status}
              </Badge>
            </div>
            {challenge.description && (
              <p className="text-sm text-gray-600 mb-3">{challenge.description}</p>
            )}
            <div className="mb-3">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Progress</span>
                <span className="font-medium">
                  {challenge.progress_count} / {challenge.goal_count}
                </span>
              </div>
              <Progress value={challenge.progress_percentage || 0} className="h-2" />
            </div>
            {challenge.time_remaining !== undefined && (
              <p className="text-xs text-gray-500">
                {challenge.time_remaining}h remaining
              </p>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
}

