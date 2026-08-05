'use client';

import { Card } from '@/components/ui/card';

export function StatCard({ label, value }: { label: string; value: string | number }) {
  const testId = `stats.${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '')}`;
  return (
    <Card className="p-6 border-border text-center" data-testid={testId}>
      <p className="text-sm text-muted-foreground mb-2">{label}</p>
      <p className="text-3xl font-bold text-foreground">{value}</p>
    </Card>
  );
}
