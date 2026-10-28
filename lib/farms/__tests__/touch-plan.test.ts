import assert from "node:assert/strict";
import {
  buildTouchPlanProgress,
  saveTouchPlan,
  type PlannerTouchDraft,
} from "../touch-plan";
import type { FarmTouch } from "@/types/database";

const draft: PlannerTouchDraft = {
  slotId: "draft",
  touchId: "scheduled",
  sequenceNumber: 1,
  cycleNumber: 2,
  suggestedDate: "2026-11-01",
  scheduledDate: "2026-11-01",
  mode: "social_ad",
  title: " Campaign ",
  notes: "",
  homesTarget: "0",
};
const original: FarmTouch[] = [
  {
    id: "done",
    farm_id: "farm",
    status: "completed",
    mode: "flyer",
    cycle_number: 1,
    scheduled_date: "2026-09-01",
    completed_date: "2026-09-15",
  },
  {
    id: "scheduled",
    farm_id: "farm",
    status: "scheduled",
    scheduled_date: "2026-11-01",
  },
  {
    id: "removed",
    farm_id: "farm",
    status: "scheduled",
    scheduled_date: "2026-12-01",
  },
  {
    id: "active",
    farm_id: "farm",
    status: "in_progress",
    scheduled_date: "2026-10-01",
  },
  {
    id: "skipped",
    farm_id: "farm",
    status: "skipped",
    scheduled_date: "2026-08-01",
  },
];

async function main() {
  const now = new Date("2026-10-27T12:00:00").getTime();
  const progress = buildTouchPlanProgress([draft], original, now);
  assert.equal(progress.total, 3);
  assert.equal(progress.completed.length, 1);
  assert.equal(progress.planned[0].plannedDate, "2026-09-01");
  assert.equal(progress.completed[0].date, "2026-09-15");
  assert.equal(progress.events.find((e) => e.id === draft.slotId)?.target, 0);
  assert.equal(
    buildTouchPlanProgress([{ ...draft, scheduledDate: "2026-10-26" }], [], now)
      .events[0].status,
    "Overdue",
  );
  assert.equal(
    buildTouchPlanProgress([{ ...draft, scheduledDate: "2026-10-27" }], [], now)
      .events[0].status,
    "Planned",
  );
  assert.equal(
    buildTouchPlanProgress([{ ...draft, scheduledDate: "" }], [], now).total,
    0,
  );

  const updates: { id: string; payload: Partial<FarmTouch> }[] = [];
  let creates = 0;
  const writer = {
    updateTouch: async (id: string, payload: Partial<FarmTouch>) => {
      updates.push({ id, payload });
    },
    createSession: async () => {
      creates++;
      return {
        id: `created-${creates}`,
        farm_id: "farm",
        status: "scheduled",
        scheduled_date: draft.scheduledDate,
      } as FarmTouch;
    },
  };
  const base = {
    farmId: "farm",
    originalTouches: original,
    writer,
    onCreated: () => {},
  };
  await saveTouchPlan({ ...base, drafts: [draft] });
  assert.equal(updates[0].payload.title, "Campaign");
  assert.equal(updates[0].payload.notes, "");
  assert.equal(updates[0].payload.homes_target, 0);
  assert.deepEqual(updates[1], {
    id: "removed",
    payload: { status: "skipped" },
  });
  assert(!updates.some((u) => ["done", "active", "skipped"].includes(u.id)));

  for (const invalid of [
    { ...draft, scheduledDate: "2026-02-30" },
    { ...draft, homesTarget: "1.5" },
    { ...draft, homesTarget: "-1" },
  ]) {
    updates.length = 0;
    await assert.rejects(saveTouchPlan({ ...base, drafts: [draft, invalid] }));
    assert.equal(
      updates.length,
      0,
      "Validate every row before writing the first row",
    );
  }

  // A later write failure must retain the ID of an earlier creation for retry.
  let retryDraft = { ...draft, touchId: null } as PlannerTouchDraft;
  const failureWriter = {
    ...writer,
    updateTouch: async () => {
      throw new Error("connection lost");
    },
  };
  await assert.rejects(
    saveTouchPlan({
      ...base,
      writer: failureWriter,
      drafts: [retryDraft, draft],
      onCreated: (_, touch) => {
        retryDraft = { ...retryDraft, touchId: touch.id };
      },
    }),
  );
  assert.equal(creates, 1);
  await saveTouchPlan({ ...base, drafts: [retryDraft, draft] });
  assert.equal(
    creates,
    1,
    "Retry updates the created record rather than inserting a duplicate",
  );

  updates.length = 0;
  await saveTouchPlan({ ...base, drafts: [] });
  assert.deepEqual(updates.map((u) => u.id).sort(), ["removed", "scheduled"]);
  console.log(
    "Touch plan: scheduled/completed date separation, progress, validation before writes, removals, history preservation, empty saves, and retry safety passed.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
