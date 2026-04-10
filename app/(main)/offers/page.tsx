'use client';

import { Link2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function OffersIndexPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] px-6 text-center">
      <Link2 className="w-12 h-12 text-muted-foreground mb-4" aria-hidden />
      <h2 className="text-lg font-semibold text-foreground mb-1">Select an offer</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Choose an offer from the list or create a new private partner link.
      </p>
      <Button asChild className="bg-red-600 hover:bg-red-700">
        <Link href="/offers/new">Create offer</Link>
      </Button>
    </div>
  );
}
