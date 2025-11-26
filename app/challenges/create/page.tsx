'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChallengeService } from '@/lib/services/ChallengeService';
import type { ChallengeType } from '@/types/database';
import { createClient } from '@/lib/supabase/client';

export default function CreateChallengePage() {
  const router = useRouter();
  const [type, setType] = useState<ChallengeType>('door_knock');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goalCount, setGoalCount] = useState(10);
  const [timeLimitHours, setTimeLimitHours] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    setLoading(true);
    try {
      const challenge = await ChallengeService.createChallenge(userId, {
        type,
        title,
        description,
        goal_count: goalCount,
        time_limit_hours: timeLimitHours,
      });

      router.push(`/challenges/${challenge.id}`);
    } catch (error) {
      console.error('Error creating challenge:', error);
      alert('Failed to create challenge');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold">Create Challenge</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-6 space-y-6">
          <div>
            <Label htmlFor="type">Challenge Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ChallengeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="door_knock">Door Knock</SelectItem>
                <SelectItem value="flyer_drop">Flyer Drop</SelectItem>
                <SelectItem value="follow_up">Follow Up</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Complete 50 door knocks this week"
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Challenge description..."
            />
          </div>

          <div>
            <Label htmlFor="goalCount">Goal Count</Label>
            <Input
              id="goalCount"
              type="number"
              min="1"
              value={goalCount}
              onChange={(e) => setGoalCount(parseInt(e.target.value))}
              required
            />
          </div>

          <div>
            <Label htmlFor="timeLimitHours">Time Limit (hours, optional)</Label>
            <Input
              id="timeLimitHours"
              type="number"
              min="1"
              value={timeLimitHours || ''}
              onChange={(e) => setTimeLimitHours(e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="Optional"
            />
          </div>

          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !title}>
              {loading ? 'Creating...' : 'Create Challenge'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

