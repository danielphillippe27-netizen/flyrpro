'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Compass, Loader2 } from 'lucide-react';

interface OrientHousesButtonProps {
  campaignId: string | null;
  onComplete?: () => void;
}

type SyncStage = 'idle' | 'fetching_shapes' | 'fetching_transport' | 'calculating_facing' | 'grounding' | 'complete';

export function OrientHousesButton({ campaignId, onComplete }: OrientHousesButtonProps) {
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<SyncStage>('idle');
  const [progress, setProgress] = useState(0);

  const handleOrient = async () => {
    if (!campaignId || loading) return;

    setLoading(true);
    setStage('fetching_shapes');
    setProgress(0);

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + 2;
        });
      }, 200);

      const response = await fetch('/api/orientation/compute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ campaignId }),
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to compute orientations');
      }

      const data = await response.json();
      
      if (data.success) {
        setStage('complete');
        setProgress(100);
        
        // Trigger map refresh
        if (onComplete) {
          onComplete();
        }
        
        console.log(`Successfully oriented ${data.successful} addresses`);
        
        // Reset after 2 seconds
        setTimeout(() => {
          setStage('idle');
          setProgress(0);
        }, 2000);
      } else {
        throw new Error('Orientation computation failed');
      }
    } catch (error) {
      console.error('Error orienting houses:', error);
      setStage('idle');
      setProgress(0);
      alert(error instanceof Error ? error.message : 'Failed to orient houses');
    } finally {
      setLoading(false);
    }
  };

  const getStageLabel = () => {
    switch (stage) {
      case 'fetching_shapes':
        return 'Fetching 3D Shapes...';
      case 'fetching_transport':
        return 'Fetching Transportation...';
      case 'calculating_facing':
        return 'Calculating Street Facing...';
      case 'grounding':
        return 'Grounding Houses...';
      case 'complete':
        return 'Complete!';
      default:
        return 'Orient Houses';
    }
  };

  if (!campaignId) {
    return null;
  }

  return (
    <div className="absolute top-20 right-4 z-20 w-64">
      <Button
        onClick={handleOrient}
        disabled={loading}
        variant="default"
        size="sm"
        className="shadow-lg bg-primary text-primary-foreground w-full"
      >
        {loading ? (
          <div className="flex flex-col items-center gap-2 w-full">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">{getStageLabel()}</span>
            <Progress value={progress} className="w-full h-1" />
          </div>
        ) : (
          <>
            <Compass className="h-4 w-4" />
            <span>{getStageLabel()}</span>
          </>
        )}
      </Button>
    </div>
  );
}
