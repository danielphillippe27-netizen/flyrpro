'use client';

import { FarmIcon } from '@/components/icons/FarmIcon';

export default function FarmsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] px-6 text-center">
      <FarmIcon className="w-12 h-12 text-primary mb-4" />
      <h2 className="text-lg font-semibold text-foreground mb-1">Select a farm</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Choose a farm from the list or create a new farm area to start working repeatable sessions.
      </p>
    </div>
  );
}
