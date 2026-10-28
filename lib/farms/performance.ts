import {
  addDays,
  startOfDay,
  startOfMonth,
  startOfWeek,
  format,
} from "date-fns";
import type { FarmAddress, FarmLead, FarmTouchAddress } from "@/types/database";
import type { EnrichedFarmTouch } from "./analytics";

export type PerformancePeriod = "7D" | "30D" | "90D" | "All Time";
export type PerformanceBucket = {
  key: string;
  label: string;
  doors: number;
  conversations: number;
  coverage: number;
  homes: number;
  touchIds: string[];
};
const answered = new Set([
  "talked",
  "lead",
  "interested",
  "appointment",
  "follow_up",
  "appointment_set",
  "callback_requested",
  "future_seller",
  "hot_lead",
]);

/** Outcome history is unique per session/home. Never infer activity from GPS, CRM contacts, or session completion. */
export function buildFarmPerformance({
  addresses,
  touches,
  outcomes,
  leads,
  cycle,
  period = "7D",
  now = new Date(),
}: {
  addresses: Pick<FarmAddress, "id">[];
  touches: EnrichedFarmTouch[];
  outcomes: FarmTouchAddress[];
  leads: FarmLead[];
  cycle?: number;
  period?: PerformancePeriod;
  now?: Date;
}) {
  const homes = new Set(addresses.map((address) => address.id));
  const sessions = new Map(
    touches
      .filter((touch) => cycle == null || touch.resolvedCycleNumber === cycle)
      .map((touch) => [touch.id, touch]),
  );
  const unique = new Map<string, FarmTouchAddress>();
  for (const outcome of outcomes) {
    if (
      !sessions.has(outcome.farm_touch_id) ||
      !homes.has(outcome.farm_address_id)
    )
      continue;
    const key = `${outcome.farm_touch_id}:${outcome.farm_address_id}`;
    const previous = unique.get(key);
    if (
      !previous ||
      Date.parse(outcome.updated_at ?? outcome.occurred_at) >
        Date.parse(previous.updated_at ?? previous.occurred_at)
    )
      unique.set(key, outcome);
  }
  const valid = [...unique.values()]
    .filter(
      (outcome) =>
        outcome.status !== "none" &&
        outcome.status !== "do_not_knock" &&
        Number.isFinite(Date.parse(outcome.occurred_at)) &&
        Date.parse(outcome.occurred_at) <= now.getTime(),
    )
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const doors = valid.filter(
    (outcome) =>
      (sessions.get(outcome.farm_touch_id)?.mode ?? "doorknock") ===
        "doorknock" &&
      (outcome.status === "no_answer" ||
        outcome.status === "delivered" ||
        answered.has(outcome.status)),
  );
  const visited = new Set(valid.map((outcome) => outcome.farm_address_id));
  const conversations = doors.filter((outcome) =>
    answered.has(outcome.status),
  ).length;
  const total = {
    homes: visited.size,
    coverage: homes.size ? visited.size / homes.size : 0,
    doors: doors.length,
    conversations,
    answerRate: doors.length ? conversations / doors.length : 0,
    leads: new Set(
      leads
        .filter(
          (lead) =>
            cycle == null || (lead.touch_id && sessions.has(lead.touch_id)),
        )
        .map((lead) => lead.id),
    ).size,
  };
  const start =
    period === "All Time"
      ? startOfMonth(valid.length ? new Date(valid[0].occurred_at) : now)
      : addDays(startOfDay(now), -(Number.parseInt(period) - 1));
  const group = (date: Date) =>
    period === "All Time"
      ? startOfMonth(date)
      : period === "90D"
        ? startOfWeek(date, { weekStartsOn: 1 })
        : startOfDay(date);
  const buckets = new Map<string, PerformanceBucket>();
  for (let date = start; date <= now; date = addDays(date, 1)) {
    const grouped = group(date);
    const key = format(grouped, "yyyy-MM-dd");
    if (!buckets.has(key))
      buckets.set(key, {
        key,
        label: format(
          grouped,
          period === "All Time" ? "MMM yyyy" : "MMM d, yyyy",
        ),
        doors: 0,
        conversations: 0,
        coverage: 0,
        homes: 0,
        touchIds: [],
      });
  }
  const active = new Set<string>();
  for (const outcome of doors) {
    const date = new Date(outcome.occurred_at);
    if (date < start) continue;
    const bucket = buckets.get(format(group(date), "yyyy-MM-dd"));
    if (!bucket) continue;
    bucket.doors++;
    if (answered.has(outcome.status)) bucket.conversations++;
    if (!bucket.touchIds.includes(outcome.farm_touch_id))
      bucket.touchIds.push(outcome.farm_touch_id);
    active.add(outcome.farm_touch_id);
  }
  // Coverage carries earlier visits forward, rather than resetting at the selected range boundary.
  const cumulative = new Set<string>();
  let index = 0;
  const result = [...buckets.values()];
  result.forEach((bucket, bucketIndex) => {
    const next = result[bucketIndex + 1];
    while (
      index < valid.length &&
      (!next ||
        format(group(new Date(valid[index].occurred_at)), "yyyy-MM-dd") <
          next.key)
    )
      cumulative.add(valid[index++].farm_address_id);
    bucket.homes = cumulative.size;
    bucket.coverage = homes.size ? cumulative.size / homes.size : 0;
  });
  const periodDoors = result.reduce((sum, bucket) => sum + bucket.doors, 0);
  return {
    total,
    buckets: result,
    periodDoors,
    periodConversations: result.reduce(
      (sum, bucket) => sum + bucket.conversations,
      0,
    ),
    averageDoors: active.size ? periodDoors / active.size : 0,
  };
}
