'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * AI Flyer Generation Page
 * 
 * Placeholder page for AI flyer generation.
 * Will be implemented with AI generation functionality.
 */
function AIFlyerContent() {
  const searchParams = useSearchParams();
  const orientation = searchParams.get('orientation') || 'vertical';
  const size = searchParams.get('size') || '8.5x5.5';
  const finish = searchParams.get('finish') || 'glossy';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">AI Flyer Generator</h1>
          <p className="text-gray-600">Generate a flyer using AI</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Your selected flyer settings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p><strong>Orientation:</strong> {orientation}</p>
              <p><strong>Size:</strong> {size}</p>
              <p><strong>Finish:</strong> {finish}</p>
            </div>
            <p className="mt-4 text-gray-500">
              AI flyer generation will be implemented here.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AIFlyerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <AIFlyerContent />
    </Suspense>
  );
}

