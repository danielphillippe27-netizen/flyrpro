export type DoorPlanHome = {
  id: string;
  formatted?: string | null;
  street_name?: string | null;
  house_number?: string | null;
  last_outcome_status?: string | null;
};
export type FarmDoorDay = { date: string; addressIds: string[] };
export type FarmDoorPlan = {
  version: 1;
  startDate: string;
  doorsPerDay: number;
  days: FarmDoorDay[];
  excludedDoNotKnock: number;
};

export function validPlanDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

// Stable street / house-number ordering keeps nearby street addresses together.
// This is an allocation of doors, not an optimized walking route.
export function buildFarmDoorPlan(
  homes: DoorPlanHome[],
  startDate: string,
  doorsPerDay: number,
): FarmDoorPlan {
  if (!validPlanDate(startDate)) throw new Error("Choose a valid start date.");
  if (!Number.isInteger(doorsPerDay) || doorsPerDay < 1 || doorsPerDay > 1000) {
    throw new Error("Doors per day must be a whole number from 1 to 1,000.");
  }
  const { eligible, excludedDoNotKnock } = eligibleFarmDoorHomes(homes);
  const days: FarmDoorDay[] = [];
  const date = new Date(`${startDate}T12:00:00Z`);
  for (let offset = 0; offset < eligible.length; offset += doorsPerDay) {
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6)
      date.setUTCDate(date.getUTCDate() + 1);
    days.push({
      date: date.toISOString().slice(0, 10),
      addressIds: eligible
        .slice(offset, offset + doorsPerDay)
        .map((home) => home.id),
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return { version: 1, startDate, doorsPerDay, days, excludedDoNotKnock };
}

export function eligibleFarmDoorHomes(homes: DoorPlanHome[]) {
  const unique = [...new Map(homes.map((home) => [home.id, home])).values()];
  const eligible = unique.filter(
    (home) => home.last_outcome_status !== "do_not_knock",
  );
  eligible.sort(
    (a, b) =>
      (a.street_name ?? a.formatted ?? "").localeCompare(
        b.street_name ?? b.formatted ?? "",
        "en",
        { numeric: true },
      ) ||
      (a.house_number ?? "").localeCompare(b.house_number ?? "", "en", {
        numeric: true,
      }) ||
      a.id.localeCompare(b.id),
  );
  return { eligible, excludedDoNotKnock: unique.length - eligible.length };
}
