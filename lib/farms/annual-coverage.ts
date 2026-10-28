import { forecastOutreach, validateOutreachSettings, type OutreachSettings } from './outreach-schedule';
import {
  eligibleFarmDoorHomes,
  validPlanDate,
  type DoorPlanHome,
} from "./door-plan";
import type { FarmTouch, FarmTouchAddress } from "@/types/database";

export type AnnualCoverageSettings = {
  startDate: string;
  homesPerWeek: number;
  weeksInPlan: number;
  weeksOff: string[];
  outreach?: OutreachSettings;
};
export type AnnualCoverageWeek = {
  number: number;
  startDate: string;
  endDate: string;
  isOff: boolean;
  addressIds: string[];
};
export type AnnualCoveragePlan = AnnualCoverageSettings & {
  version: 1;
  weeks: AnnualCoverageWeek[];
  totalHomes: number;
  excludedDoNotKnock: number;
  minimumHomesPerWeek: number;
  unassignedAddressIds: string[];
  finishDate: string | null;
};
export function annualPlanDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function validateAnnualCoverageSettings(
  value: unknown,
): AnnualCoverageSettings {
  const settings = value as Partial<AnnualCoverageSettings> | null;
  if (
    !settings ||
    typeof settings.startDate !== "string" ||
    !validPlanDate(settings.startDate)
  )
    throw new Error("Choose a valid start date.");
  if (
    !Number.isInteger(settings.homesPerWeek) ||
    settings.homesPerWeek! < 1 ||
    settings.homesPerWeek! > 10000
  )
    throw new Error("Homes per week must be a whole number from 1 to 10,000.");
  if (
    !Number.isInteger(settings.weeksInPlan) ||
    settings.weeksInPlan! < 1 ||
    settings.weeksInPlan! > 52
  )
    throw new Error("Choose a plan length from 1 to 52 weeks.");
  if (
    !Array.isArray(settings.weeksOff) ||
    settings.weeksOff.length > 52 ||
    settings.weeksOff.some(
      (date) => typeof date !== "string" || !validPlanDate(date),
    )
  )
    throw new Error("Choose valid holiday weeks.");
  const dates = new Set(
    Array.from({ length: settings.weeksInPlan! }, (_, index) =>
      annualPlanDate(settings.startDate!, index * 7),
    ),
  );
  if (settings.weeksOff.some((date) => !dates.has(date)))
    throw new Error("Holiday weeks must fall within the selected plan.");
  const weeksOff = [...new Set(settings.weeksOff)].sort();
  if (weeksOff.length === settings.weeksInPlan)
    throw new Error("Keep at least one working week in your plan.");
  return {
    startDate: settings.startDate,
    homesPerWeek: settings.homesPerWeek!,
    weeksInPlan: settings.weeksInPlan!,
    weeksOff,
    ...(settings.outreach ? { outreach: validateOutreachSettings(settings.outreach) } : {}),
  };
}
export function buildAnnualCoveragePlan(
  homes: DoorPlanHome[],
  input: AnnualCoverageSettings,
): AnnualCoveragePlan {
  const settings = validateAnnualCoverageSettings(input);
  const { eligible, excludedDoNotKnock } = eligibleFarmDoorHomes(homes);
  const off = new Set(settings.weeksOff);
  const daily = settings.outreach ? forecastOutreach(eligible.length, settings.startDate, settings.weeksInPlan, settings.outreach, settings.weeksOff) : null;
  let offset = 0;
  const weeks = Array.from({ length: settings.weeksInPlan }, (_, index) => {
    const startDate = annualPlanDate(settings.startDate, index * 7);
    const workDays = daily?.workingDates.filter(date => date >= startDate && date <= annualPlanDate(startDate, 6)).length;
    const isOff = off.has(startDate) || workDays === 0;
    const capacity = daily ? (daily.doorPasses ? (workDays ?? 0) * daily.doorsPerDay : 0) : settings.homesPerWeek;
    const addressIds = isOff
      ? []
      : eligible
          .slice(offset, offset + capacity)
          .map((home) => home.id);
    offset += addressIds.length;
    return {
      number: index + 1,
      startDate,
      endDate: annualPlanDate(startDate, 6),
      isOff,
      addressIds,
    };
  });
  return {
    ...settings,
    version: 1,
    weeks,
    totalHomes: eligible.length,
    excludedDoNotKnock,
    minimumHomesPerWeek: Math.ceil(
      eligible.length / (settings.weeksInPlan - settings.weeksOff.length),
    ),
    unassignedAddressIds: daily && !daily.doorPasses ? [] : eligible.slice(offset).map((home) => home.id),
    finishDate:
      daily ? daily.finishDate : offset === eligible.length
        ? ([...weeks].reverse().find((week) => week.addressIds.length)
            ?.endDate ?? null)
        : null,
  };
}
const doorStatuses = new Set([
  "no_answer",
  "delivered",
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
/** First recorded door visit in the annual window; progress never comes from planned assignments. */
export function annualCoverageVisits(
  plan: AnnualCoveragePlan,
  touches: Pick<FarmTouch, "id" | "mode">[],
  outcomes: FarmTouchAddress[],
  now = new Date(),
) {
  const ids = new Set([
    ...plan.weeks.flatMap((week) => week.addressIds),
    ...plan.unassignedAddressIds,
  ]);
  const sessions = new Set(
    touches
      .filter((touch) => (touch.mode ?? "doorknock") === "doorknock")
      .map((touch) => touch.id),
  );
  const from = new Date(`${plan.startDate}T00:00:00`).getTime();
  const to = Math.min(
    now.getTime(),
    new Date(
      `${annualPlanDate(plan.startDate, plan.weeksInPlan * 7)}T00:00:00`,
    ).getTime() - 1,
  );
  const visits = new Map<string, number>();
  for (const outcome of outcomes) {
    const at = Date.parse(outcome.occurred_at);
    if (
      !ids.has(outcome.farm_address_id) ||
      !sessions.has(outcome.farm_touch_id) ||
      !doorStatuses.has(outcome.status) ||
      at < from ||
      at > to ||
      !Number.isFinite(at)
    )
      continue;
    visits.set(
      outcome.farm_address_id,
      Math.min(visits.get(outcome.farm_address_id) ?? Infinity, at),
    );
  }
  return visits;
}
