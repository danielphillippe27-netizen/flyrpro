import assert from "node:assert/strict";
import { buildFarmPerformance } from "../performance";
import { resolveFarmTouchesWithCycles } from "../analytics";
import type { FarmTouch, FarmTouchAddress, FarmLead } from "@/types/database";
const now = new Date("2026-10-27T12:00:00");
const touches = resolveFarmTouchesWithCycles(
  [
    {
      id: "old",
      farm_id: "f",
      cycle_number: 1,
      mode: "doorknock",
      status: "completed",
      scheduled_date: "2026-10-01",
    },
    {
      id: "live",
      farm_id: "f",
      cycle_number: 2,
      mode: "doorknock",
      status: "in_progress",
      scheduled_date: "2026-10-27",
    },
    {
      id: "flyers",
      farm_id: "f",
      cycle_number: 2,
      mode: "flyer",
      status: "completed",
      scheduled_date: "2026-10-25",
    },
  ] as FarmTouch[],
  1,
);
const outcome = (
  id: string,
  touch: string,
  home: string,
  date: string,
  status: FarmTouchAddress["status"],
): FarmTouchAddress => ({
  id,
  farm_id: "f",
  farm_touch_id: touch,
  farm_address_id: home,
  occurred_at: date + "T10:00:00",
  created_at: date + "T10:00:00",
  status,
});
const outcomes = [
  outcome("a", "old", "1", "2026-10-01", "no_answer"),
  outcome("b", "live", "1", "2026-10-27", "talked"),
  outcome("duplicate", "live", "1", "2026-10-27", "talked"),
  outcome("c", "live", "2", "2026-10-27", "no_answer"),
  outcome("d", "flyers", "3", "2026-10-25", "delivered"),
  outcome("e", "live", "4", "2026-10-27", "none"),
  outcome("f", "live", "5", "2026-10-27", "do_not_knock"),
  outcome("g", "live", "missing", "2026-10-27", "talked"),
  outcome("h", "unknown", "4", "2026-10-27", "talked"),
  outcome("future", "live", "4", "2026-10-28", "talked"),
];
const args = {
  addresses: ["1", "2", "3", "4", "5"].map((id) => ({ id })),
  touches,
  outcomes,
  leads: [
    { id: "l", touch_id: "old" },
    { id: "m", touch_id: "live" },
  ] as FarmLead[],
  now,
};
const data = buildFarmPerformance(args);
assert.equal(data.total.homes, 3);
assert.equal(data.total.coverage, 0.6);
assert.equal(
  data.total.doors,
  3,
  "Revisits across sessions count; duplicate syncs do not",
);
assert.equal(
  data.total.conversations,
  1,
  "Conversations come from door outcomes, not CRM contact counts",
);
assert.equal(data.total.answerRate, 1 / 3);
assert.equal(data.periodDoors, 2, "Live session activity is included");
assert.equal(data.averageDoors, 2, "Average uses sessions active in range");
assert.equal(data.buckets.length, 7);
assert.equal(
  data.buckets[0].homes,
  1,
  "Coverage carries earlier visits forward",
);
assert.equal(data.buckets.at(-1)?.homes, data.total.homes);
assert.deepEqual(data.buckets.at(-1)?.touchIds, ["live"]);
const cycle = buildFarmPerformance({ ...args, cycle: 2 });
assert.equal(cycle.total.leads, 1);
assert.equal(cycle.total.doors, 2);
assert.equal(cycle.buckets[0].homes, 0);
for (const period of ["7D", "30D", "90D", "All Time"] as const) {
  const result = buildFarmPerformance({ ...args, period });
  assert.equal(result.buckets.at(-1)?.coverage, result.total.coverage);
  assert(
    result.buckets.every(
      (bucket, index) =>
        index === 0 || bucket.homes >= result.buckets[index - 1].homes,
    ),
  );
}
const revised = buildFarmPerformance({
  ...args,
  outcomes: [
    outcomes[1],
    {
      ...outcomes[1],
      id: "revision",
      status: "none",
      updated_at: "2026-10-27T11:00:00",
    },
  ],
});
assert.equal(
  revised.total.doors,
  0,
  "Latest revision wins, including clearing an outcome",
);
const empty = buildFarmPerformance({ ...args, outcomes: [], leads: [] });
assert.equal(empty.periodDoors, 0);
assert.equal(empty.total.answerRate, 0);
assert.equal(empty.averageDoors, 0);
assert.equal(
  buildFarmPerformance({ ...args, addresses: [] }).total.coverage,
  0,
);
console.log(
  "Farm performance: deduplication, revisions, live sessions, distinct coverage, modes, cycle scoping, period grouping, baseline coverage, leads and empty states passed.",
);
