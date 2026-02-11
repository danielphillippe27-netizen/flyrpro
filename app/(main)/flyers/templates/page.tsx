'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { flyerTemplates } from '@/lib/flyerTemplates';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Flyer Templates List Page
 * 
 * Displays available flyer templates in a grid layout.
 * Users can select a template to start editing.
 */
function FlyersTemplatesContent() {
  const searchParams = useSearchParams();
  // Query params are available if needed: orientation, size, finish
  const orientation = searchParams.get('orientation');
  const size = searchParams.get('size');
  const finish = searchParams.get('finish');
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Flyer Templates</h1>
          <p className="text-gray-600">
            Choose a template to start creating your flyer
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {flyerTemplates.map((template) => (
            <Card
              key={template.id}
              className="bg-white border-gray-200 hover:border-gray-300 transition-colors"
            >
              <CardHeader>
                <CardTitle className="text-gray-900">{template.name}</CardTitle>
                {template.description && (
                  <CardDescription className="text-gray-600">
                    {template.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-gray-500">
                  <p>Size: {template.width} × {template.height}px</p>
                  <p>Elements: {template.elements.length}</p>
                </div>
              </CardContent>
              <CardFooter>
                <Link href={`/flyers/${template.id}`} className="w-full">
                  <Button className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-medium">
                    Use Template
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function FlyersTemplatesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <FlyersTemplatesContent />
    </Suspense>
  );
}

