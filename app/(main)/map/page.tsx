'use client';

import { FlyrMapView } from '@/components/map/FlyrMapView';

export default function MapPage() {
  return (
    <div className="h-[calc(100vh-5rem)] w-full">
      <FlyrMapView />
    </div>
  );
}

