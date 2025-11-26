'use client';

import { Card } from '@/components/ui/card';

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-6">
      <p className="text-sm text-gray-600 mb-2">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </Card>
  );
}

