'use client';

import Link from 'next/link';
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
export default function FlyersPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Flyer Templates</h1>
          <p className="text-slate-400">
            Choose a template to start creating your flyer
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {flyerTemplates.map((template) => (
            <Card
              key={template.id}
              className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors"
            >
              <CardHeader>
                <CardTitle className="text-slate-100">{template.name}</CardTitle>
                {template.description && (
                  <CardDescription className="text-slate-400">
                    {template.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-slate-500">
                  <p>Size: {template.width} × {template.height}px</p>
                  <p>Elements: {template.elements.length}</p>
                </div>
              </CardContent>
              <CardFooter>
                <Link href={`/flyers/${template.id}`} className="w-full">
                  <Button className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-medium">
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

