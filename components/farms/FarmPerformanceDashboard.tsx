"use client";

import { useMemo } from "react";
import { Home, MessageSquare, Target, Users } from "lucide-react";
import type { FarmAddress, CampaignAddress, FarmLead, FarmTouchAddress } from "@/types/database";
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
  campaignAddresses,
  touches,
  outcomes,
  activitySessions,
  leads,
  currentCycle,
  scope,
  onScopeChange,
}: {
  name: string;
  addresses: FarmAddress[];
  campaignAddresses: CampaignAddress[];
  touches: EnrichedFarmTouch[];
  outcomes: FarmTouchAddress[];
  activitySessions: FarmActivitySession[];
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
  const campaignVisited = useMemo(() => new Set(campaignAddresses.filter((home) => home.visited).map((home) => home.id)), [campaignAddresses]);
  const outcomeHomes = useMemo(() => {
    const sessionIds = new Set(touches.map((touch) => touch.id));
    return new Set(outcomes.filter((outcome) => sessionIds.has(outcome.farm_touch_id) && outcome.status !== "none" && outcome.status !== "do_not_knock" && Number.isFinite(Date.parse(outcome.occurred_at)) && Date.parse(outcome.occurred_at) <= Date.now()).map((outcome) => outcome.farm_address_id));
  }, [outcomes, touches]);
  const additionalHomes = scope === "all_time" ? addresses.filter((home) => home.campaign_address_id && campaignVisited.has(home.campaign_address_id) && !outcomeHomes.has(home.id)).length : 0;
  const homesVisited = data.total.homes + additionalHomes;
  const coverage = addresses.length ? homesVisited / addresses.length : 0;
  const sessionTotals = farmSessionTotals(activitySessions, touches, scope === "current_cycle" ? currentCycle : undefined);
  const activity = sessionTotals ?? data.total;
  const metrics = [
    {
      label: "Door Attempts",
      value: number(activity.doors),
      hint: sessionTotals ? "Recorded session activity · Includes repeat visits" : "Recorded address-level attempts",
      icon: Home,
    },
    {
      label: "Confirmed Unique Homes",
      value: number(homesVisited),
      hint: "Homes with saved visit records",
      icon: Home,
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
              {percent(coverage)}
            </p>
          </div>
        </div>
        <div
          className="relative mt-4 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Farm coverage"
          aria-valuenow={Math.round(coverage * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-[#E33449] transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${coverage * 100}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {scope === "current_cycle"
            ? `Coverage in cycle ${currentCycle}`
            : "Coverage across all cycles"}{" "}
          · Each home counted once
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Coverage uses saved home records. Session totals can include repeat visits and visits without a synced home record.
        </p>
      </section>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 xl:grid-cols-5">
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
