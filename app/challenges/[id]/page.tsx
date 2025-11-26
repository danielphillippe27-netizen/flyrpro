'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChallengeService } from '@/lib/services/ChallengeService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { Challenge } from '@/types/database';

export default function ChallengePage() {
  const params = useParams();
  const router = useRouter();
  const challengeId = params.id as string;

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await ChallengeService.fetchChallenge(challengeId);
        setChallenge(data);
      } catch (error) {
        console.error('Error loading challenge:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [challengeId]);

  const handleUpdateProgress = async () => {
    if (!challenge) return;
    try {
      const updated = await ChallengeService.updateProgress(challenge.id, 1);
      setChallenge(updated);
    } catch (error) {
      console.error('Error updating progress:', error);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!challenge) {
    return <div className="min-h-screen flex items-center justify-center">Challenge not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Button variant="ghost" asChild className="mb-2">
            <Link href="/home">← Back to Home</Link>
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{challenge.title}</h1>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={challenge.is_completed ? 'default' : 'secondary'}>
                  {challenge.status}
                </Badge>
                <span className="text-sm text-gray-600">{challenge.type.replace('_', ' ')}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {challenge.description && (
          <div className="bg-white rounded-2xl border p-6">
            <p className="text-gray-700">{challenge.description}</p>
          </div>
        )}

        <div className="bg-white rounded-2xl border p-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-600">Progress</span>
            <span className="text-sm font-bold">
              {challenge.progress_count} / {challenge.goal_count}
            </span>
          </div>
          <Progress value={challenge.progress_percentage || 0} className="h-3" />
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>{Math.round(challenge.progress_percentage || 0)}% complete</span>
            {challenge.time_remaining !== undefined && (
              <span>{challenge.time_remaining}h remaining</span>
            )}
          </div>
        </div>

        {!challenge.is_completed && (
          <div className="bg-white rounded-2xl border p-6">
            <Button onClick={handleUpdateProgress} className="w-full">
              Increment Progress
            </Button>
          </div>
        )}

        {challenge.is_completed && (
          <div className="bg-green-50 rounded-2xl border border-green-200 p-6 text-center">
            <p className="text-lg font-semibold text-green-800">Challenge Completed! 🎉</p>
            {challenge.completed_at && (
              <p className="text-sm text-green-600 mt-2">
                Completed on {new Date(challenge.completed_at).toLocaleDateString()}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

