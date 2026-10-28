'use client';

import { TabsList, TabsTrigger } from '@/components/ui/tabs';

export function FarmNavigation() {
  return (
    <div className="min-w-0 max-w-full shrink-0 overflow-x-auto">
      <TabsList aria-label="Farm navigation" className="justify-start">
        <TabsTrigger value="overview">Dashboard</TabsTrigger>
        <TabsTrigger value="map">Map</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="leads">Contacts</TabsTrigger>
        <TabsTrigger value="finance">Finance</TabsTrigger>
        <TabsTrigger value="qr">QR Codes</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="configure">Settings</TabsTrigger>
      </TabsList>
    </div>
  );
}
