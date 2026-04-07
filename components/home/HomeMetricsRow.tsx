'use client';

import type { ComponentType } from 'react';
import { CalendarCheck, DoorOpen, MessageSquare, Users } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

type HomeMetricsRowProps = {
  doors: number;
  convos: number;
  leads: number;
  appointments: number;
};

type MetricCardProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
};

function MetricCard({ icon: Icon, label, value }: MetricCardProps) {
  return (
    <Card className="operator-surface rounded-2xl border border-border/70 bg-card shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4 text-primary" />
          <span>{label}</span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">this week</p>
      </CardContent>
    </Card>
  );
}

export function HomeMetricsRow({ doors, convos, leads, appointments }: HomeMetricsRowProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={DoorOpen} label="Doors" value={doors} />
      <MetricCard icon={MessageSquare} label="Convos" value={convos} />
      <MetricCard icon={Users} label="Leads" value={leads} />
      <MetricCard icon={CalendarCheck} label="Appointments" value={appointments} />
    </div>
  );
}
