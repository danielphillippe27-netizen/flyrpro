"use client";

import { useMemo } from "react";
import { DoorOpen, MessageSquare, Target, Users } from "lucide-react";
import type { FarmAddress, FarmLead, FarmTouchAddress } from "@/types/database";
import type { EnrichedFarmTouch } from "@/lib/farms/analytics";
import { buildFarmPerformance } from "@/lib/farms/performance";
import { farmSessionTotals, type FarmActivitySession } from "@/lib/farms/session-totals";

const number = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const percent = (value: number) => `${number(value * 100)}%`;
const panel = "rounded-2xl border border-border/60 bg-card shadow-sm";

export function FarmPerformanceDashboard({
  name,
  addresses,
  touches,
  outcomes,
  activitySessions,
  leads,
  currentCycle,
  scope,
}: {
  name: string;
  addresses: FarmAddress[];
  touches: EnrichedFarmTouch[];
  outcomes: FarmTouchAddress[];
  activitySessions: FarmActivitySession[];
  leads: FarmLead[];
  currentCycle: number;
  scope: "current_cycle" | "all_time";
}) {
  const data = useMemo(
    () =>
      buildFarmPerformance({
        addresses,
        touches,
        outcomes,
        leads,
        cycle: scope === "current_cycle" ? currentCycle : undefined,
      }),
    [addresses, touches, outcomes, leads, currentCycle, scope],
  );
  const sessionTotals = farmSessionTotals(activitySessions, touches, scope === "current_cycle" ? currentCycle : undefined);
  const activity = sessionTotals ?? data.total;
  const metrics = [
    {
      label: "Doors Knocked",
      value: number(activity.doors),
      hint: "Recorded door activity, including repeat visits",
      icon: DoorOpen,
    },
    {
      label: "Conversations",
      value: number(activity.conversations),
      hint: "Recorded door conversations",
      icon: MessageSquare,
    },
    {
      label: "Answer Rate",
      value: percent(activity.answerRate),
      hint: `${number(activity.doors)} door attempts`,
      icon: Users,
    },
    {
      label: "Leads Generated",
      value: number(data.total.leads),
      hint: "Recorded farm leads",
      icon: Target,
    },
  ];
  return (
    <div className="space-y-5">
      <section
        className={`${panel} relative overflow-hidden p-5 sm:p-6`}
        aria-label="Farm overview"
      >
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[#E33449]/5 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Farm overview · Cycle {currentCycle}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">
              {name}
            </h2>
          </div>
        </div>
        <div className="relative mt-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
              Farm pass progress
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tighter tabular-nums sm:text-6xl">
              {percent(addresses.length ? activity.doors / addresses.length : 0)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {scope === "current_cycle" ? `Cycle ${currentCycle}` : "All time"} · {number(addresses.length)} homes in this farm
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Door knocks as a percentage of one farm pass, including repeat visits.</p>
      </section>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4">
        {metrics.map(({ label, value, hint, icon: Icon }) => (
          <section key={label} className={`${panel} p-5 sm:p-6`}>
            <div className="flex items-center justify-between gap-2 text-muted-foreground">
              <h3 className="text-sm font-medium">{label}</h3>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            </div>
            <p
              key={value}
              className="mt-5 text-3xl font-semibold tracking-tight tabular-nums motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
            >
              {value}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
