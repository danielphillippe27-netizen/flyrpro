"use client";

import { useMemo } from "react";
import { Home, MessageSquare, Target, Users } from "lucide-react";
import type { FarmAddress, FarmLead, FarmTouchAddress } from "@/types/database";
import type { EnrichedFarmTouch } from "@/lib/farms/analytics";
import { buildFarmPerformance } from "@/lib/farms/performance";

const number = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const percent = (value: number) => `${number(value * 100)}%`;
const panel = "rounded-2xl border border-border/60 bg-card shadow-sm";

export function FarmPerformanceDashboard({
  name,
  addresses,
  touches,
  outcomes,
  leads,
  currentCycle,
  scope,
  onScopeChange,
}: {
  name: string;
  addresses: FarmAddress[];
  touches: EnrichedFarmTouch[];
  outcomes: FarmTouchAddress[];
  leads: FarmLead[];
  currentCycle: number;
  scope: "current_cycle" | "all_time";
  onScopeChange: (scope: "current_cycle" | "all_time") => void;
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
  const metrics = [
    {
      label: "Homes Visited",
      value: number(data.total.homes),
      hint: "Unique homes reached",
      icon: Home,
    },
    {
      label: "Conversations",
      value: number(data.total.conversations),
      hint: "Recorded door conversations",
      icon: MessageSquare,
    },
    {
      label: "Answer Rate",
      value: percent(data.total.answerRate),
      hint: `${number(data.total.doors)} door attempts`,
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
          <div
            className="inline-flex w-fit rounded-lg bg-muted/50 p-1"
            role="group"
            aria-label="Dashboard scope"
          >
            {(["current_cycle", "all_time"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => onScopeChange(value)}
                className={`rounded-md px-3 py-2 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${scope === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {value === "current_cycle"
                  ? `Cycle ${currentCycle}`
                  : "All Time"}
              </button>
            ))}
          </div>
        </div>
        <div className="relative mt-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
              Farm coverage
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tighter tabular-nums sm:text-6xl">
              {percent(data.total.coverage)}
            </p>
          </div>
        </div>
        <div
          className="relative mt-4 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Farm coverage"
          aria-valuenow={Math.round(data.total.coverage * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-[#E33449] transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${data.total.coverage * 100}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {scope === "current_cycle"
            ? `Coverage in cycle ${currentCycle}`
            : "Coverage across all cycles"}{" "}
          · Each home counted once
        </p>
      </section>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 xl:grid-cols-4">
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
