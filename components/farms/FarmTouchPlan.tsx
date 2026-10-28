"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FarmSessionMode, FarmTouch } from "@/types/database";

import {
  buildTouchPlanProgress,
  planDateTime as dateTime,
  type PlannerTouchDraft,
} from "@/lib/farms/touch-plan";
export type { PlannerTouchDraft } from "@/lib/farms/touch-plan";
const MODES: Record<FarmSessionMode, string> = {
  doorknock: "Doorknock",
  flyer: "Flyer",
  canada_post: "Canada Post",
  pop_by: "Pop by",
  letter: "Letter",
  phone_call: "Phone call",
  social_ad: "Social ad",
  event: "Event",
};
const dateLabel = (value: string) =>
  new Date(dateTime(value)).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function FarmTouchPlan({
  drafts,
  touches,
  saving,
  message,
  error,
  onChange,
  onAdd,
  onRemove,
  onReset,
  onSave,
}: {
  drafts: PlannerTouchDraft[];
  touches: FarmTouch[];
  saving: boolean;
  message: string;
  error?: string;
  onChange: (
    slotId: string,
    field: "scheduledDate" | "mode" | "title" | "notes" | "homesTarget",
    value: string,
  ) => void;
  onAdd: () => void;
  onRemove: (slotId: string) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const gradientId = useId().replace(/:/g, "");
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(1000);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setChartWidth(Math.max(280, Math.round(width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const plotEnd = chartWidth - 28;
  const plotWidth = plotEnd - 52;
  const now = Date.now();
  const {
    events: rawEvents,
    completed: completedEvents,
    planned,
    total,
  } = buildTouchPlanProgress(drafts, touches, now);
  const events = rawEvents.map((event) => ({
    ...event,
    title: event.title || MODES[event.mode],
  }));
  const times = [
    ...events.map((e) => dateTime(e.date)),
    ...planned.map((e) => dateTime(e.plannedDate)),
  ];
  const completedCount = completedEvents.length;
  const day = 86400000;
  const min = Math.min(now - day * 7, ...times) - day * 3;
  const max = Math.max(now + day * 30, ...times) + day * 3;
  const x = (time: number) => 52 + ((time - min) / (max - min)) * plotWidth;
  const ceiling = Math.max(4, total);
  const y = (count: number) => 228 - (count / ceiling) * 180;
  const planPoints = `52,228 ${planned.map((e, i) => `${x(dateTime(e.plannedDate))},${y(i + 1)}`).join(" ")} ${plotEnd},${y(total)}`;
  const actualPoints = `52,228 ${completedEvents.map((e, i) => `${x(dateTime(e.date))},${y(i + 1)}`).join(" ")} ${x(now)},${y(completedCount)}`;
  const next = events.find((e) => e.status !== "Completed");
  function edit(id: string) {
    setSelected(id);
    document
      .getElementById(`touch-row-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    document
      .getElementById(`touch-title-${id}`)
      ?.focus({ preventScroll: true });
  }
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-xl font-semibold">Your touchpoint plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose what happens and when. Adjust your plan as you go.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={saving} onClick={onReset}>
              Undo changes
            </Button>
            <Button disabled={saving} onClick={onSave}>
              {saving ? "Saving…" : "Save plan"}
            </Button>
          </div>
        </div>
        <fieldset disabled={saving} className="min-w-0">
          <div className="hidden grid-cols-[40px_1fr_155px_160px_80px] gap-3 border-b border-border bg-muted/30 px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground lg:grid">
            <span>#</span>
            <span>Touchpoint</span>
            <span>Type</span>
            <span>Date</span>
            <span className="text-right">Edit</span>
          </div>
          {drafts.map((draft, index) => (
            <div
              id={`touch-row-${draft.slotId}`}
              key={draft.slotId}
              className={`border-b border-border px-5 py-3 transition-colors ${selected === draft.slotId ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : ""}`}
            >
              <div className="grid items-center gap-3 lg:grid-cols-[40px_1fr_155px_160px_80px]">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Input
                  id={`touch-title-${draft.slotId}`}
                  aria-label={`Touchpoint ${index + 1} title`}
                  value={draft.title}
                  placeholder={`${MODES[draft.mode]} touchpoint`}
                  onChange={(e) =>
                    onChange(draft.slotId, "title", e.target.value)
                  }
                />
                <select
                  aria-label={`Touchpoint ${index + 1} type`}
                  className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.mode}
                  onChange={(e) =>
                    onChange(draft.slotId, "mode", e.target.value)
                  }
                >
                  {Object.entries(MODES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label={`Touchpoint ${index + 1} date`}
                  type="date"
                  value={draft.scheduledDate}
                  onChange={(e) =>
                    onChange(draft.slotId, "scheduledDate", e.target.value)
                  }
                />
                <div className="flex justify-end gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Details for touchpoint ${index + 1}`}
                    aria-expanded={selected === draft.slotId}
                    onClick={() =>
                      setSelected(
                        selected === draft.slotId ? null : draft.slotId,
                      )
                    }
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove touchpoint ${index + 1}`}
                    onClick={() => onRemove(draft.slotId)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
              {selected === draft.slotId ? (
                <div className="mt-3 grid gap-3 pl-0 lg:grid-cols-[180px_1fr] lg:pl-[52px]">
                  <label className="space-y-2 text-xs text-muted-foreground">
                    Target homes
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={draft.homesTarget}
                      onChange={(e) =>
                        onChange(draft.slotId, "homesTarget", e.target.value)
                      }
                      placeholder="Optional"
                    />
                  </label>
                  <label className="space-y-2 text-xs text-muted-foreground">
                    Notes
                    <Input
                      value={draft.notes}
                      onChange={(e) =>
                        onChange(draft.slotId, "notes", e.target.value)
                      }
                      placeholder="Anything to remember for this touchpoint"
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ))}
          {!drafts.length ? (
            <p className="p-5 text-sm text-muted-foreground">
              No upcoming touchpoints. Add one to start your plan.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <Button variant="outline" onClick={onAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add touchpoint
            </Button>
            <p className="text-xs text-muted-foreground">
              {drafts.length} planned · Save to keep edits and removals
            </p>
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="px-5 pb-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {message ? (
          <p
            role="status"
            className="px-5 pb-4 text-sm text-emerald-600 dark:text-emerald-400"
          >
            {message}
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              The long game
            </p>
            <h2 className="mt-2 text-xl font-semibold">Progress over time</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every touch builds momentum. See your progress against the plan.
            </p>
          </div>
          <div className="flex gap-5 text-xs text-muted-foreground">
            <span>
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary" />
              Completed
            </span>
            <span>
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-muted-foreground" />
              Planned
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 px-5 pb-3 md:grid-cols-4">
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              {completedCount}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {total}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Touchpoints completed
            </p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              {total ? Math.round((completedCount / total) * 100) : 0}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Of all touchpoints
            </p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              {events.filter((e) => e.status === "Overdue").length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Overdue touchpoints
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold">
              {next ? dateLabel(next.date) : "All caught up"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {next ? `Next: ${next.title}` : "Add your next touchpoint"}
            </p>
          </div>
        </div>
        <div className="px-3">
          <div ref={chartRef}>
            <svg
              viewBox={`0 0 ${chartWidth} 280`}
              className="w-full"
              role="group"
              aria-label={`Cumulative touchpoint progress: ${completedCount} completed of ${total} planned. Timeline details below.`}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--primary)"
                    stopOpacity="0.2"
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--primary)"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3, 4].map((i) => {
                const count = Math.round((ceiling * i) / 4);
                return (
                  <g key={i}>
                    <line
                      x1="52"
                      x2={plotEnd}
                      y1={y(count)}
                      y2={y(count)}
                      stroke="currentColor"
                      className="text-border"
                    />
                    <text
                      x="35"
                      y={y(count) + 4}
                      textAnchor="end"
                      fill="currentColor"
                      className="text-muted-foreground"
                      fontSize="11"
                    >
                      {count}
                    </text>
                  </g>
                );
              })}
              <polygon
                points={`${actualPoints} ${x(now)},228`}
                fill={`url(#${gradientId})`}
              />
              <polyline
                points={planPoints}
                fill="none"
                stroke="currentColor"
                className="text-muted-foreground"
                strokeWidth="2"
                strokeDasharray="5 6"
              />
              <polyline
                points={actualPoints}
                fill="none"
                stroke="var(--primary)"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
              <line
                x1={x(now)}
                x2={x(now)}
                y1="30"
                y2="232"
                stroke="currentColor"
                className="text-muted-foreground"
                strokeDasharray="3 5"
              />
              <text
                x={x(now)}
                y="20"
                textAnchor="middle"
                fill="currentColor"
                className="text-muted-foreground"
                fontSize="11"
              >
                TODAY
              </text>
              {planned.map((event, i) => (
                <g
                  key={event.id}
                  role={
                    drafts.some((d) => d.slotId === event.id)
                      ? "button"
                      : undefined
                  }
                  tabIndex={
                    drafts.some((d) => d.slotId === event.id) && !saving
                      ? 0
                      : undefined
                  }
                  aria-label={
                    drafts.some((d) => d.slotId === event.id)
                      ? `Edit ${event.title || MODES[event.mode]}`
                      : `Planned ${event.title || MODES[event.mode]}`
                  }
                  className={
                    drafts.some((d) => d.slotId === event.id)
                      ? "cursor-pointer outline-none focus:text-primary"
                      : ""
                  }
                  onClick={() => {
                    if (!saving && drafts.some((d) => d.slotId === event.id))
                      edit(event.id);
                  }}
                  onKeyDown={(e) => {
                    if (
                      !saving &&
                      drafts.some((d) => d.slotId === event.id) &&
                      (e.key === "Enter" || e.key === " ")
                    ) {
                      e.preventDefault();
                      edit(event.id);
                    }
                  }}
                >
                  <circle
                    cx={x(dateTime(event.plannedDate))}
                    cy={y(i + 1)}
                    r="14"
                    fill="transparent"
                  />
                  <circle
                    key={event.id}
                    cx={x(dateTime(event.plannedDate))}
                    cy={y(i + 1)}
                    r="5"
                    fill="var(--card)"
                    stroke="currentColor"
                  >
                    <title>
                      {dateLabel(event.plannedDate)} ·{" "}
                      {event.title || MODES[event.mode]} · {event.status}
                    </title>
                  </circle>
                </g>
              ))}
              {completedEvents.map((event, i) => (
                <circle
                  key={event.id}
                  cx={x(dateTime(event.date))}
                  cy={y(i + 1)}
                  r="5"
                  fill="var(--primary)"
                >
                  <title>
                    Completed {dateLabel(event.date)} ·{" "}
                    {event.title || MODES[event.mode]}
                  </title>
                </circle>
              ))}
              {(chartWidth < 600 ? [0, 2, 4] : [0, 1, 2, 3, 4]).map((i) => (
                <text
                  key={i}
                  x={52 + (i * plotWidth) / 4}
                  y="260"
                  textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
                  fill="currentColor"
                  className="text-muted-foreground"
                  fontSize="11"
                >
                  {new Date(min + ((max - min) * i) / 4).toLocaleDateString(
                    "en-CA",
                    { month: "short", day: "numeric", year: "2-digit" },
                  )}
                </text>
              ))}
            </svg>
          </div>
        </div>
        <div className="border-t border-border p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Touchpoint timeline</h3>
            <span className="text-xs text-muted-foreground">
              Select an upcoming touchpoint to edit
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {events.map((event) => (
              <div
                key={event.id}
                className={`w-56 shrink-0 rounded-xl border p-4 ${selected === event.id ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span
                    className={
                      event.status === "Completed"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : event.status === "Overdue"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    }
                  >
                    {event.status === "Completed" ? (
                      <Check className="mr-1 inline h-3 w-3" />
                    ) : null}
                    {event.status}
                  </span>
                  <span className="text-muted-foreground">
                    Cycle {event.cycle ?? "—"}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold">{event.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dateLabel(event.date)} · {MODES[event.mode]}
                </p>
                {event.target != null || event.reached != null ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {event.reached ?? 0} / {event.target ?? "—"} homes reached
                  </p>
                ) : null}
                {drafts.some((d) => d.slotId === event.id) ? (
                  <div className="mt-3 flex items-center justify-between">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => edit(event.id)}
                    >
                      Edit <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={saving}
                      aria-label={`Remove ${event.title}`}
                      onClick={() => onRemove(event.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {!events.length ? (
            <p className="text-sm text-muted-foreground">
              Your timeline will appear when you add a touchpoint.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
