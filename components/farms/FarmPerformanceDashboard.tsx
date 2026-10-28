"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Home,
  MessageSquare,
  MousePointer2,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import type { FarmAddress, FarmLead, FarmTouchAddress } from "@/types/database";
import type { EnrichedFarmTouch } from "@/lib/farms/analytics";
import {
  buildFarmPerformance,
  type PerformanceBucket,
  type PerformancePeriod,
} from "@/lib/farms/performance";

const number = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const percent = (value: number) => `${number(value * 100)}%`;
const panel = "rounded-2xl border border-border/60 bg-card shadow-sm";
const periods: PerformancePeriod[] = ["7D", "30D", "90D", "All Time"];

export function FarmPerformanceDashboard({
  name,
  addresses,
  touches,
  outcomes,
  leads,
  currentCycle,
  scope,
  onScopeChange,
  onSessions,
}: {
  name: string;
  addresses: FarmAddress[];
  touches: EnrichedFarmTouch[];
  outcomes: FarmTouchAddress[];
  leads: FarmLead[];
  currentCycle: number;
  scope: "current_cycle" | "all_time";
  onScopeChange: (scope: "current_cycle" | "all_time") => void;
  onSessions: (ids: string[]) => void;
}) {
  const [period, setPeriod] = useState<PerformancePeriod>("7D");
  const data = useMemo(
    () =>
      buildFarmPerformance({
        addresses,
        touches,
        outcomes,
        leads,
        cycle: scope === "current_cycle" ? currentCycle : undefined,
        period,
      }),
    [addresses, touches, outcomes, leads, currentCycle, scope, period],
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
        className={`${panel} relative overflow-hidden p-6 sm:p-8`}
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
        <div className="relative mt-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
              Farm coverage
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tighter tabular-nums sm:text-6xl">
              {percent(data.total.coverage)}
            </p>
          </div>
          <p className="pb-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {number(data.total.homes)}
            </span>{" "}
            / {number(addresses.length)} homes visited
          </p>
        </div>
        <div
          className="relative mt-6 h-2 overflow-hidden rounded-full bg-muted"
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
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section
          className={`${panel} min-w-0 p-5 sm:p-7`}
          aria-labelledby="door-performance-title"
        >
          <div className="flex flex-col justify-between gap-4">
            <div>
              <h2
                id="door-performance-title"
                className="text-lg font-semibold tracking-tight"
              >
                Door-Knocking Performance
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Track daily activity and conversations across your campaign.
              </p>
            </div>
            <div
              role="group"
              aria-label="Chart time range"
              className="inline-flex w-fit flex-wrap rounded-lg bg-muted/50 p-1"
            >
              {periods.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={value === period}
                  onClick={() => setPeriod(value)}
                  className={`rounded-md px-3 py-2 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-ring ${period === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="my-7 grid grid-cols-2 gap-5 sm:grid-cols-3">
            {[
              ["Doors visited", number(data.periodDoors)],
              ["Conversations", number(data.periodConversations)],
              ["Avg. doors / active session", number(data.averageDoors)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-2xl font-semibold tracking-tight tabular-nums">
                  {value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap gap-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm bg-[#E33449]" />
              Doors Visited
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm bg-[#668BB5]" />
              Conversations
            </span>
          </div>
          <PerformanceChart
            key={`${scope}-${period}`}
            buckets={data.buckets}
            onSessions={onSessions}
          />
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            {period === "90D"
              ? "Weekly"
              : period === "All Time"
                ? "Monthly"
                : "Daily"}{" "}
            totals · Includes activity from sessions in progress. Select a
            period to inspect its sessions.
          </p>
        </section>
        <section
          className={`${panel} flex min-w-0 flex-col p-5 sm:p-7`}
          aria-labelledby="farm-coverage-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2
                id="farm-coverage-title"
                className="text-lg font-semibold tracking-tight"
              >
                Farm Coverage Over Time
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                See your reach grow, one home at a time.
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {percent(data.total.coverage)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {number(data.total.homes)} unique homes
              </p>
            </div>
          </div>
          <div className="mt-auto pt-7">
            <PerformanceChart
              key={`coverage-${scope}-${period}`}
              buckets={data.buckets}
              coverage
            />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Cumulative unique homes reached across recorded farm touches ·{" "}
            {scope === "current_cycle" ? `Cycle ${currentCycle}` : "All Time"} ·{" "}
            {period} view
          </p>
        </section>
      </div>
    </div>
  );
}

function PerformanceChart({
  buckets,
  coverage = false,
  onSessions,
}: {
  buckets: PerformanceBucket[];
  coverage?: boolean;
  onSessions?: (ids: string[]) => void;
}) {
  const gradient = useId().replace(/:/g, "");
  const container = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(800);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setChartWidth(Math.max(260, entry.contentRect.width)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const [selected, setSelected] = useState<number | null>(null);
  const active = selected == null ? null : buckets[selected];
  const maximum = coverage
    ? 100
    : Math.max(4, ...buckets.map((bucket) => bucket.doors));
  const top = coverage ? 100 : Math.ceil(maximum / 4) * 4;
  const width = chartWidth,
    height = 260,
    left = 48,
    right = 16,
    bottom = 34,
    plotHeight = height - bottom - 12;
  const slot = (width - left - right) / Math.max(buckets.length, 1);
  const x = (index: number) => left + slot * (index + 0.5);
  const y = (value: number) => height - bottom - (value / top) * plotHeight;
  const points = buckets
    .map((bucket, index) => `${x(index)},${y(bucket.coverage * 100)}`)
    .join(" ");
  const hasData = buckets.some((bucket) =>
    coverage ? bucket.homes > 0 : bucket.doors > 0,
  );
  return (
    <div>
      <div className="relative" ref={container}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto min-h-[180px] w-full overflow-visible"
          role="group"
          aria-label={
            coverage
              ? "Cumulative farm coverage chart, percent"
              : "Doors visited and conversations chart, number of visits"
          }
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#E33449" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#E33449" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={width - right}
                y1={y((top * tick) / 4)}
                y2={y((top * tick) / 4)}
                stroke="currentColor"
                className="text-border"
                strokeDasharray={tick ? "3 5" : undefined}
              />
              <text
                x={left - 12}
                y={y((top * tick) / 4) + 4}
                textAnchor="end"
                fill="currentColor"
                className="text-muted-foreground"
                fontSize="11"
              >
                {number((top * tick) / 4)}
                {coverage ? "%" : ""}
              </text>
            </g>
          ))}
          {coverage && hasData && (
            <>
              <polygon
                points={`${x(0)},${y(0)} ${points} ${x(buckets.length - 1)},${y(0)}`}
                fill={`url(#${gradient})`}
              />
              <polyline
                points={points}
                fill="none"
                stroke="#E33449"
                strokeWidth="3"
                strokeLinejoin="round"
              />
            </>
          )}
          {coverage && hasData && buckets.length === 1 && (
            <circle
              cx={x(0)}
              cy={y(buckets[0].coverage * 100)}
              r={5}
              fill="#E33449"
            />
          )}
          {buckets.map((bucket, index) => (
            <g key={bucket.key}>
              {selected === index && (
                <rect
                  x={left + index * slot}
                  y={8}
                  width={slot}
                  height={plotHeight + 4}
                  fill="currentColor"
                  opacity="0.04"
                />
              )}
              {!coverage && (
                <>
                  {[
                    { value: bucket.doors, color: "#E33449", offset: -0.31 },
                    {
                      value: bucket.conversations,
                      color: "#668BB5",
                      offset: 0.04,
                    },
                  ].map((bar) => (
                    <rect
                      key={bar.color}
                      x={x(index) + slot * bar.offset}
                      y={y(bar.value)}
                      width={Math.min(32, slot * 0.27)}
                      height={y(0) - y(bar.value)}
                      rx={3}
                      fill={bar.color}
                      className="transition-[height,y] duration-300 motion-reduce:transition-none"
                    />
                  ))}
                </>
              )}
              {coverage && selected === index && (
                <circle
                  cx={x(index)}
                  cy={y(bucket.coverage * 100)}
                  r={5}
                  fill="#E33449"
                  stroke="var(--background)"
                  strokeWidth={2}
                />
              )}
              {(index === 0 ||
                index === buckets.length - 1 ||
                index %
                  Math.max(
                    1,
                    Math.ceil(buckets.length / (width < 500 ? 3 : 6)),
                  ) ===
                  0) && (
                <text
                  x={x(index)}
                  y={height - 8}
                  textAnchor="middle"
                  fill="currentColor"
                  className="text-muted-foreground"
                  fontSize="11"
                >
                  {bucket.label.replace(/, \d{4}$/, "")}
                </text>
              )}
              <rect
                x={left + index * slot}
                y={4}
                width={slot}
                height={plotHeight + 8}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${bucket.label}: ${coverage ? `${number(bucket.homes)} homes, ${percent(bucket.coverage)} coverage` : `${bucket.doors} doors, ${bucket.conversations} conversations, ${percent(bucket.doors ? bucket.conversations / bucket.doors : 0)} answer rate`}. Press Enter to inspect.`}
                onMouseEnter={() => setSelected(index)}
                onFocus={() => setSelected(index)}
                onClick={() => {
                  setSelected(index);
                  if (!coverage && bucket.touchIds.length)
                    onSessions?.(bucket.touchIds);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(index);
                    if (!coverage && bucket.touchIds.length)
                      onSessions?.(bucket.touchIds);
                  }
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const target =
                      event.key === "ArrowRight"
                        ? event.currentTarget.parentElement?.nextElementSibling
                        : event.currentTarget.parentElement
                            ?.previousElementSibling;
                    target
                      ?.querySelector<SVGElement>('[role="button"]')
                      ?.focus();
                  }
                }}
                className="cursor-pointer outline-none focus-visible:stroke-ring focus-visible:[stroke-width:2]"
              />
            </g>
          ))}
        </svg>
        {active && hasData && (
          <div
            role="tooltip"
            className="pointer-events-none absolute right-3 top-0 z-10 max-w-[220px] rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          >
            <p className="font-medium">{active.label}</p>
            <p className="mt-1 text-muted-foreground">
              {coverage
                ? `${number(active.homes)} homes · ${percent(active.coverage)}`
                : `${active.doors} doors · ${active.conversations} conversations`}
            </p>
            {!coverage && (
              <p className="mt-1 text-muted-foreground">
                Answer rate:{" "}
                {percent(
                  active.doors ? active.conversations / active.doors : 0,
                )}
              </p>
            )}
          </div>
        )}
        {!hasData && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/80 px-6 text-center">
            <TrendingUp className="mb-1 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">
              {coverage
                ? "Your farm’s story starts at the first door."
                : "Your performance starts at the first door."}
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              {coverage
                ? "Record a home visit to start tracking your coverage."
                : "Recorded door visits and conversations will appear here. Try a wider range to see earlier activity."}
            </p>
          </div>
        )}
      </div>
      <div
        className="mt-3 min-h-[60px] rounded-lg bg-muted/30 px-4 py-3 text-xs"
        aria-live="polite"
        aria-atomic="true"
      >
        {active ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{active.label}</p>
              <p className="mt-1 text-muted-foreground">
                {coverage
                  ? `${number(active.homes)} unique homes · ${percent(active.coverage)} coverage`
                  : `${active.doors} doors · ${active.conversations} conversations · ${percent(active.doors ? active.conversations / active.doors : 0)} answer rate`}
              </p>
            </div>
            {!coverage && active.touchIds.length > 0 && (
              <button
                type="button"
                onClick={() => onSessions?.(active.touchIds)}
                className="inline-flex items-center gap-1 rounded px-2 py-2 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                View sessions
                <ArrowUpRight className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground">
            <MousePointer2 className="h-3 w-3" />
            Hover, tap, or use the keyboard to inspect a period.
          </p>
        )}
      </div>
    </div>
  );
}
