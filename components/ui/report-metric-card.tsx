import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function ReportMetricCard({ icon: Icon, label, value, helper }: {
  icon: LucideIcon;
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <Card className="operator-surface rounded-2xl border border-border/70 bg-card shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
          <span>{label}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="break-words text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        {helper && <p className="mt-1 truncate text-xs text-muted-foreground">{helper}</p>}
      </CardContent>
    </Card>
  );
}
