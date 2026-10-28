import type { FarmSessionMode, FarmTouch } from "@/types/database";

export type PlannerTouchDraft = {
  slotId: string;
  touchId: string | null;
  sequenceNumber: number;
  cycleNumber: number;
  suggestedDate: string;
  scheduledDate: string;
  mode: FarmSessionMode;
  title: string;
  notes: string;
  homesTarget: string;
};

export function localPlanDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function planDateTime(value: string): number {
  return new Date(value.length === 10 ? `${value}T12:00:00` : value).getTime();
}

export function buildTouchPlanProgress(
  drafts: PlannerTouchDraft[],
  touches: FarmTouch[],
  now = Date.now(),
) {
  const historical = touches.filter(
    (t) => t.status === "completed" || t.status === "in_progress",
  );
  const events = [
    ...historical.map((t) => ({
      id: t.id,
      date:
        t.status === "completed"
          ? t.completed_date || t.scheduled_date
          : t.scheduled_date,
      plannedDate: t.scheduled_date,
      title: t.title ?? "",
      mode: t.mode ?? ("doorknock" as FarmSessionMode),
      status: t.status === "completed" ? "Completed" : "In progress",
      cycle: t.cycle_number,
      reached: t.homes_reached,
      target: t.homes_target,
    })),
    ...drafts.map((d) => ({
      id: d.slotId,
      date: d.scheduledDate,
      plannedDate: d.scheduledDate,
      title: d.title,
      mode: d.mode,
      status:
        d.scheduledDate < localPlanDate(new Date(now)) ? "Overdue" : "Planned",
      cycle: d.cycleNumber,
      reached: null,
      target:
        d.homesTarget.trim() && Number.isFinite(Number(d.homesTarget))
          ? Number(d.homesTarget)
          : null,
    })),
  ]
    .filter((e) => Number.isFinite(planDateTime(e.date)))
    .sort((a, b) => planDateTime(a.date) - planDateTime(b.date));
  const completed = events.filter((e) => e.status === "Completed");
  const planned = [...events]
    .filter((e) => Number.isFinite(planDateTime(e.plannedDate)))
    .sort((a, b) => planDateTime(a.plannedDate) - planDateTime(b.plannedDate));
  return { events, completed, planned, total: events.length };
}

type SessionPayload = {
  farmId: string;
  workspaceId?: string | null;
  cycleNumber: number;
  mode: FarmSessionMode;
  title?: string;
  scheduledDate: string;
  notes?: string;
  homesTarget: number | null;
};

// The writer is the existing authenticated FarmTouchService in the browser.
export async function saveTouchPlan({
  drafts,
  originalTouches,
  farmId,
  workspaceId,
  writer,
  onCreated,
}: {
  drafts: PlannerTouchDraft[];
  originalTouches: FarmTouch[];
  farmId: string;
  workspaceId?: string | null;
  writer: {
    createSession: (payload: SessionPayload) => Promise<FarmTouch>;
    updateTouch: (id: string, payload: Partial<FarmTouch>) => Promise<void>;
  };
  onCreated: (slotId: string, touch: FarmTouch) => void;
}): Promise<void> {
  const validated = drafts.map((draft) => {
    const date = new Date(`${draft.scheduledDate}T12:00:00`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.scheduledDate) ||
      !Number.isFinite(date.getTime()) ||
      localPlanDate(date) !== draft.scheduledDate
    ) {
      throw new Error(`Choose a valid date for cycle ${draft.cycleNumber}.`);
    }
    const target = draft.homesTarget.trim() ? Number(draft.homesTarget) : null;
    if (target != null && (!Number.isInteger(target) || target < 0)) {
      throw new Error("Target homes must be a whole number of zero or more.");
    }
    return { draft, date: date.toISOString(), target };
  });
  const retained = new Set(drafts.map((d) => d.touchId).filter(Boolean));
  for (const { draft, date, target } of validated) {
    if (draft.touchId) {
      await writer.updateTouch(draft.touchId, {
        mode: draft.mode,
        title: draft.title.trim() || null,
        scheduled_date: date,
        notes: draft.notes.trim(),
        homes_target: target,
      });
    } else {
      const created = await writer.createSession({
        farmId,
        workspaceId,
        cycleNumber: draft.cycleNumber,
        mode: draft.mode,
        title: draft.title.trim() || undefined,
        scheduledDate: date,
        notes: draft.notes.trim() || undefined,
        homesTarget: target,
      });
      retained.add(created.id);
      onCreated(draft.slotId, created);
    }
  }
  for (const touch of originalTouches) {
    if (touch.status === "scheduled" && !retained.has(touch.id)) {
      // Retain activity records while removing this touch from the upcoming plan.
      await writer.updateTouch(touch.id, { status: "skipped" });
    }
  }
}
