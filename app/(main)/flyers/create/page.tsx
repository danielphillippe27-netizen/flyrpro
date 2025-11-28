'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, FileImage } from 'lucide-react';

type Orientation = 'horizontal' | 'vertical';
type Size = '8.5x5.5' | '5x7';
type Finish = 'glossy' | 'matte';

export default function FlyerCreatePage() {
  const router = useRouter();
  const [orientation, setOrientation] = useState<Orientation>('vertical');
  const [size, setSize] = useState<Size>('8.5x5.5');
  const [finish, setFinish] = useState<Finish>('glossy');

  const handleAIFlyer = () => {
    // Build query params with selected options
    const params = new URLSearchParams({
      orientation,
      size,
      finish,
      type: 'ai',
    });
    router.push(`/flyers/ai?${params.toString()}`);
  };

  const handleTemplate = () => {
    // Build query params with selected options
    const params = new URLSearchParams({
      orientation,
      size,
      finish,
      type: 'template',
    });
    router.push(`/flyers/templates?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Create Flyer</h1>
          <p className="text-gray-600">Configure your flyer settings</p>
        </div>

        <div className="space-y-6">
          {/* Orientation Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Orientation</CardTitle>
              <CardDescription>Choose the orientation for your flyer</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button
                  variant={orientation === 'horizontal' ? 'default' : 'outline'}
                  onClick={() => setOrientation('horizontal')}
                  className="flex-1"
                >
                  Horizontal
                </Button>
                <Button
                  variant={orientation === 'vertical' ? 'default' : 'outline'}
                  onClick={() => setOrientation('vertical')}
                  className="flex-1"
                >
                  Vertical
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Size Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Size</CardTitle>
              <CardDescription>Select the size of your flyer</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button
                  variant={size === '8.5x5.5' ? 'default' : 'outline'}
                  onClick={() => setSize('8.5x5.5')}
                  className="flex-1"
                >
                  8.5 × 5.5
                </Button>
                <Button
                  variant={size === '5x7' ? 'default' : 'outline'}
                  onClick={() => setSize('5x7')}
                  className="flex-1"
                >
                  5 × 7
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Finish Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Finish</CardTitle>
              <CardDescription>Choose the finish for your flyer</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button
                  variant={finish === 'glossy' ? 'default' : 'outline'}
                  onClick={() => setFinish('glossy')}
                  className="flex-1"
                >
                  Glossy
                </Button>
                <Button
                  variant={finish === 'matte' ? 'default' : 'outline'}
                  onClick={() => setFinish('matte')}
                  className="flex-1"
                >
                  Matte
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-4 pt-4">
            <Button
              onClick={handleAIFlyer}
              className="h-auto p-6 flex flex-col items-center gap-3"
              size="lg"
            >
              <Sparkles className="w-8 h-8" />
              <span className="text-lg font-semibold">AI Flyer</span>
            </Button>
            <Button
              onClick={handleTemplate}
              variant="outline"
              className="h-auto p-6 flex flex-col items-center gap-3"
              size="lg"
            >
              <FileImage className="w-8 h-8" />
              <span className="text-lg font-semibold">Template</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

