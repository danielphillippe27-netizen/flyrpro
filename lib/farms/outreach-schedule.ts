import { validPlanDate } from './door-plan';

export type OutreachSettings = {
  doorsPerDay: number;
  workingDays: number[];
  doorPasses: number;
  callPasses: number;
  callsPerDay: number;
  holidays: string[];
};
export const defaultOutreachSettings = (): OutreachSettings => ({ doorsPerDay: 50, workingDays: [1, 2, 3, 4, 5, 6], doorPasses: 1, callPasses: 0, callsPerDay: 50, holidays: [] });
export function outreachDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function validateOutreachSettings(raw: unknown): OutreachSettings {
  if (!raw || typeof raw !== 'object') throw Error('Choose your outreach schedule.');
  const value = raw as OutreachSettings;
  for (const key of ['doorsPerDay', 'callsPerDay'] as const)
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 1000) throw Error('Daily targets must be whole numbers from 1 to 1,000.');
  for (const key of ['doorPasses', 'callPasses'] as const)
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 12) throw Error('Choose between 0 and 12 rounds per channel.');
  if (!value.doorPasses && !value.callPasses) throw Error('Choose at least one door-knocking or calling round.');
  if (!Array.isArray(value.workingDays) || !value.workingDays.length || value.workingDays.length > 7 || value.workingDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw Error('Choose at least one working day.');
  if (!Array.isArray(value.holidays) || value.holidays.length > 366 || value.holidays.some(date => typeof date !== 'string' || !validPlanDate(date))) throw Error('Choose valid holiday dates.');
  return { doorsPerDay: value.doorsPerDay, callsPerDay: value.callsPerDay, doorPasses: value.doorPasses, callPasses: value.callPasses, workingDays: [...new Set(value.workingDays)].sort(), holidays: [...new Set(value.holidays)].sort() };
}
export function forecastOutreach(totalHomes: number, startDate: string, weeks: number, raw: OutreachSettings, weeksOff: string[] = []) {
  const settings = validateOutreachSettings(raw);
  if (!validPlanDate(startDate) || !Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw Error('Choose a valid start date and 1–52 weeks.');
  if (!Number.isInteger(totalHomes) || totalHomes < 0) throw Error('A valid home count is required.');
  const holidays = new Set(settings.holidays);
  const off = new Set(weeksOff.flatMap(date => Array.from({ length: 7 }, (_, i) => outreachDate(date, i))));
  const doorAttempts = totalHomes * settings.doorPasses;
  const callAttempts = totalHomes * settings.callPasses;
  const doorDays = Math.ceil(doorAttempts / settings.doorsPerDay);
  const callDays = Math.ceil(callAttempts / settings.callsPerDay);
  const daysNeeded = Math.max(doorDays, callDays);
  const workingDates: string[] = [];
  let availableDays = 0, holidaysExcluded = 0;
  // Bounded projection includes finish dates beyond the chosen horizon.
  for (let i = 0; i < 3660; i++) {
    const date = outreachDate(startDate, i);
    const working = settings.workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    if (i < weeks * 7 && working && (holidays.has(date) || off.has(date))) holidaysExcluded++;
    if (working && !holidays.has(date) && !off.has(date)) {
      if (i < weeks * 7) availableDays++;
      workingDates.push(date);
    }
    if (i >= weeks * 7 - 1 && workingDates.length >= daysNeeded) break;
  }
  const within = workingDates.filter(date => date <= outreachDate(startDate, weeks * 7 - 1));
  return { ...settings, totalHomes, doorAttempts, callAttempts, doorDays, callDays, daysNeeded, availableDays, holidaysExcluded,
    spareDays: availableDays - daysNeeded, fits: daysNeeded <= availableDays,
    finishDate: daysNeeded ? workingDates[daysNeeded - 1] ?? null : null,
    minimumDoorsPerDay: availableDays ? Math.ceil(doorAttempts / availableDays) : null,
    minimumCallsPerDay: availableDays ? Math.ceil(callAttempts / availableDays) : null,
    workingDates: within,
    doorRoundDates: Array.from({ length: settings.doorPasses }, (_, i) => workingDates[Math.floor(i * totalHomes / settings.doorsPerDay)] ?? null),
    callRoundDates: Array.from({ length: settings.callPasses }, (_, i) => workingDates[Math.floor(i * totalHomes / settings.callsPerDay)] ?? null),
  };
}
