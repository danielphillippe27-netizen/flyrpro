"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FarmAddress, FarmTouchAddress, CampaignAddress, FarmSessionMode, FarmTouch } from "@/types/database";

import {
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

export function FarmTouchPlan({
  drafts,
  touches,
  addresses,
  outcomes,
  campaignAddresses,
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
  addresses: FarmAddress[];
  campaignAddresses: CampaignAddress[];
  outcomes: FarmTouchAddress[];
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
  const [planOpen, setPlanOpen] = useState(false);
  const planId = useId();
  const [focusRequest, setFocusRequest] = useState(0);
  const pendingFocus = useRef<string | null>(null);
  const previousDraftIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!planOpen) return;
    const id =
      pendingFocus.current ??
      (previousDraftIds.current
        ? drafts.find((draft) => !previousDraftIds.current!.has(draft.slotId))
            ?.slotId
        : null);
    if (!id) return;
    const input = document.getElementById(`touch-title-${id}`);
    if (!input) return;
    pendingFocus.current = null;
    previousDraftIds.current = null;
    setSelected(id);
    input.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
    input.focus({ preventScroll: true });
  }, [drafts, planOpen, focusRequest]);
  function addTouchpoint() {
    pendingFocus.current = null;
    setFocusRequest((request) => request + 1);
    previousDraftIds.current = new Set(drafts.map((draft) => draft.slotId));
    setPlanOpen(true);
    onAdd();
  }
  const now = Date.now();
  const homeIds = new Set(addresses.map((address) => address.id));
  const sessionIds = new Set(touches.filter((touch) => ["doorknock", "flyer", "pop_by"].includes(touch.mode ?? "doorknock")).map((touch) => touch.id));
  const firstVisits = new Map<string, number>();
  const visitKeys = new Set<string>();
  for (const outcome of outcomes) {
    const time = Date.parse(outcome.occurred_at);
    if (!homeIds.has(outcome.farm_address_id) || !sessionIds.has(outcome.farm_touch_id) ||
        outcome.status === "none" || outcome.status === "do_not_knock" ||
        !Number.isFinite(time) || time > now) continue;
    firstVisits.set(outcome.farm_address_id, Math.min(firstVisits.get(outcome.farm_address_id) ?? Infinity, time));
    visitKeys.add(`${outcome.farm_touch_id}:${outcome.farm_address_id}`);
  }
  const visitTimes = [...firstVisits.values()].sort((a, b) => a - b);
  const campaignVisited = new Set(campaignAddresses.filter((address) => address.visited).map((address) => address.id));
  const historicalHomes = addresses.filter((address) => address.campaign_address_id && campaignVisited.has(address.campaign_address_id) && !firstVisits.has(address.id)).length;
  const totalHomes = homeIds.size;
  const visitedHomes = visitTimes.length + historicalHomes;
  const earliest = visitTimes[0] ?? now;
  const min = Math.min(earliest, now - 86400000);
  const x = (time: number) => 40 + ((time - min) / Math.max(now - min, 1)) * 920;
  const y = (count: number) => 210 - (count / Math.max(totalHomes, 1)) * 180;
  const points = `40,210 ${visitTimes.map((time, index) => `${x(time)},${y(index + 1)}`).join(" ")} 960,${y(visitTimes.length)}`;
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-border bg-card p-5">
        <h2 className="text-xl font-semibold">Homes visited over time</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each home counts once toward coverage. Repeat visits are included in the total.</p>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">{visitedHomes.toLocaleString()} / {totalHomes.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">homes visited · {totalHomes ? Math.round(visitedHomes / totalHomes * 100) : 0}% · {historicalHomes ? "At least " : ""}{(visitKeys.size + historicalHomes).toLocaleString()} total visits</span>
        </div>
        {historicalHomes > 0 && <p className="mt-2 text-xs text-muted-foreground">{historicalHomes} linked campaign homes have no dated Farm visit history and are included in the total, but not the timeline.</p>}
        <svg viewBox="0 0 1000 240" className="mt-4 w-full" role="img" aria-label={`${visitedHomes} of ${totalHomes} homes visited over time`}>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <g key={fraction}>
            <line x1="40" x2="960" y1={y(totalHomes * fraction)} y2={y(totalHomes * fraction)} stroke="currentColor" className="text-border" />
            <text x="32" y={y(totalHomes * fraction) + 4} textAnchor="end" fill="currentColor" className="text-muted-foreground" fontSize="11">{Math.round(totalHomes * fraction)}</text>
          </g>)}
          <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          <text x="960" y="235" textAnchor="end" fill="currentColor" className="text-muted-foreground" fontSize="11">TODAY</text>
        </svg>
      </section>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-3 p-5">
          <Button
            size="icon"
            variant="outline"
            aria-label="Add touchpoint"
            disabled={saving}
            onClick={addTouchpoint}
            className="shrink-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <h2 className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setPlanOpen((open) => !open)}
              aria-expanded={planOpen}
              aria-controls={planId}
              className="flex w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
            >
              <span>
                <span className="block text-lg font-semibold">
                  Your touchpoint plan
                </span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {drafts.length} planned · Expand to edit your touchpoints
                </span>
              </span>
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${planOpen ? "rotate-180" : ""}`}
              />
            </button>
          </h2>
        </div>
        <div id={planId} hidden={!planOpen}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Choose what happens and when. Adjust your plan as you go.
            </p>
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
              <Button variant="outline" onClick={addTouchpoint}>
                <Plus className="mr-2 h-4 w-4" />
                Add another touchpoint
              </Button>
              <p className="text-xs text-muted-foreground">
                {drafts.length} planned · Save to keep edits and removals
              </p>
            </div>
          </fieldset>
        </div>
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
    </div>
  );
}
