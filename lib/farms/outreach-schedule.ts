import { validPlanDate } from './door-plan';

export type OutreachSettings = {
  doorsPerDay: number;
  workingDays: number[];
  doorPasses: number;
  callPasses: number;
  callsPerDay: number;
  holidays: string[];
  holidaysEnabled?: boolean;
  holidayCountry?: string;
  holidayRegion?: string;
  publicHolidays?: string[];
  extraDaysOff?: string[];
  extraDaysOffCount?: number;
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
  if (!Array.isArray(value.holidays) || value.holidays.length > 732 || value.holidays.some(date => typeof date !== 'string' || !validPlanDate(date))) throw Error('Choose valid holiday dates.');
  for (const dates of [value.publicHolidays, value.extraDaysOff]) {
    if (dates !== undefined && (!Array.isArray(dates) || dates.length > 366 || dates.some(date => typeof date !== 'string' || !validPlanDate(date)))) throw Error('Choose valid days off.');
  }
  if (value.extraDaysOffCount !== undefined && (!Number.isInteger(value.extraDaysOffCount) || value.extraDaysOffCount < 0 || value.extraDaysOffCount > 366)) throw Error('Extra days off must be a whole number from 0 to 366.');
  if (value.holidaysEnabled !== undefined && typeof value.holidaysEnabled !== 'boolean') throw Error('Choose a valid holiday setting.');
  for (const code of [value.holidayCountry, value.holidayRegion]) if (code !== undefined && (typeof code !== 'string' || !/^[A-Z]{2,3}$/.test(code))) throw Error('Choose a valid holiday region.');
  const extraDaysOff = value.extraDaysOff === undefined ? undefined : [...new Set(value.extraDaysOff)].sort();
  const publicHolidays = value.publicHolidays === undefined ? undefined : [...new Set(value.publicHolidays)].sort();
  const holidays = extraDaysOff === undefined ? [...new Set(value.holidays)].sort() : [...new Set([...extraDaysOff, ...(value.holidaysEnabled ? publicHolidays ?? [] : [])])].sort();
  return { doorsPerDay: value.doorsPerDay, callsPerDay: value.callsPerDay, doorPasses: value.doorPasses, callPasses: value.callPasses, workingDays: [...new Set(value.workingDays)].sort(), holidays, ...(extraDaysOff === undefined ? {} : { extraDaysOff }), ...(value.extraDaysOffCount === undefined ? {} : { extraDaysOffCount: value.extraDaysOffCount }), ...(publicHolidays === undefined ? {} : { publicHolidays }), ...(value.holidaysEnabled === undefined ? {} : { holidaysEnabled: value.holidaysEnabled }), ...(value.holidayCountry ? { holidayCountry: value.holidayCountry } : {}), ...(value.holidayRegion ? { holidayRegion: value.holidayRegion } : {}) };
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
  let workingDates: string[] = [];
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
    if (i >= weeks * 7 - 1 && workingDates.length >= daysNeeded + (settings.extraDaysOffCount ?? 0)) break;
  }
  const planEnd = outreachDate(startDate, weeks * 7 - 1);
  // Spread personal days across the work needed, so even a short plan includes them.
  const extraCount = settings.extraDaysOffCount ?? 0;
  const projectionDays = daysNeeded + extraCount;
  const estimatedOff = new Set(workingDates.slice(0, projectionDays).filter((_, i) =>
    Math.ceil((i + 1) * extraCount / projectionDays) > Math.ceil(i * extraCount / projectionDays)));
  workingDates = workingDates.filter(date => !estimatedOff.has(date));
  const extraDaysOffInPlan = [...estimatedOff].filter(date => date <= planEnd).length;
  availableDays -= extraDaysOffInPlan;
  const finishDate = daysNeeded ? workingDates[daysNeeded - 1] ?? null : null;
  const calendarDays = finishDate ? Math.round((Date.parse(finishDate) - Date.parse(startDate)) / 86400000) + 1 : 0;
  const timeOffDays = finishDate ? [...new Set([...holidays, ...off, ...estimatedOff])].filter(date =>
    date >= startDate && date <= finishDate && settings.workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())).length : 0;
  const nonWorkingWeekdays = finishDate ? calendarDays - daysNeeded - timeOffDays : 0;
  const within = workingDates.filter(date => date <= planEnd);
  return { ...settings, totalHomes, doorAttempts, callAttempts, doorDays, callDays, daysNeeded, availableDays, holidaysExcluded,
    spareDays: availableDays - daysNeeded, fits: daysNeeded <= availableDays,
    finishDate, calendarDays, timeOffDays, nonWorkingWeekdays, extraDaysOffInPlan, estimatedDaysOff: [...estimatedOff],
    minimumDoorsPerDay: availableDays ? Math.ceil(doorAttempts / availableDays) : null,
    minimumCallsPerDay: availableDays ? Math.ceil(callAttempts / availableDays) : null,
    workingDates: within,
    doorRoundDates: Array.from({ length: settings.doorPasses }, (_, i) => workingDates[Math.floor(i * totalHomes / settings.doorsPerDay)] ?? null),
    callRoundDates: Array.from({ length: settings.callPasses }, (_, i) => workingDates[Math.floor(i * totalHomes / settings.callsPerDay)] ?? null),
  };
}
