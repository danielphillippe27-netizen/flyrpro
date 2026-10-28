"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Download, Home, Palmtree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  annualCoverageVisits,
  annualPlanDate,
  buildAnnualCoveragePlan,
  type AnnualCoveragePlan,
  type AnnualCoverageSettings,
} from "@/lib/farms/annual-coverage";
import { FarmOutreachQuestions } from './FarmOutreachQuestions';
import { defaultOutreachSettings } from '@/lib/farms/outreach-schedule';
import { validPlanDate } from "@/lib/farms/door-plan";
import type {
  FarmAddress,
  FarmTouch,
  FarmTouchAddress,
} from "@/types/database";
import { localPlanDate } from "@/lib/farms/touch-plan";

const count = (value: number) => value.toLocaleString();
const label = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const panel = "rounded-2xl border border-border bg-card";
function settingsKey(settings: AnnualCoverageSettings) {
  return JSON.stringify([
    settings.startDate,
    settings.homesPerWeek,
    settings.weeksInPlan,
    [...settings.weeksOff].sort(),
    settings.outreach ?? null,
  ]);
}

export function FarmAnnualCoveragePlan({
  farmId,
  addresses,
  touches,
  outcomes,
  onAddContact,
}: {
  farmId: string;
  addresses: FarmAddress[];
  touches: FarmTouch[];
  outcomes: FarmTouchAddress[];
  onAddContact: (home: FarmAddress) => void;
}) {
  const [settings, setSettings] = useState<AnnualCoverageSettings>(() => ({
    startDate: localPlanDate(),
    homesPerWeek: 100,
    weeksInPlan: 52,
    weeksOff: [],
    outreach: defaultOutreachSettings(),
  }));
  const [saved, setSaved] = useState<AnnualCoveragePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(0);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [homeLimit, setHomeLimit] = useState(25);
  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setLoadFailed(false);
      setError("");
      try {
        const response = await fetch(`/api/farms/${farmId}/annual-coverage`, {
          signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Unable to load your annual plan.");
        if (signal.aborted) return;
        setSaved(data.plan ?? null);
        if (data.plan)
          setSettings({
            startDate: data.plan.startDate,
            homesPerWeek: data.plan.homesPerWeek,
            weeksInPlan: data.plan.weeksInPlan,
            weeksOff: data.plan.weeksOff,
            outreach: data.plan.outreach,
          });
      } catch (reason) {
        if (!signal.aborted) {
          setLoadFailed(true);
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load annual plan.",
          );
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [farmId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const preview = useMemo(() => {
    try {
      return { plan: buildAnnualCoveragePlan(addresses, settings), error: "" };
    } catch (reason) {
      return {
        plan: null,
        error:
          reason instanceof Error
            ? reason.message
            : "Check your plan settings.",
      };
    }
  }, [addresses, settings]);
  const plan = preview.plan;
  const homes = useMemo(
    () => new Map(addresses.map((home) => [home.id, home])),
    [addresses],
  );
  const currentHomeIds = useMemo(
    () =>
      new Set(
        addresses
          .filter((home) => home.last_outcome_status !== "do_not_knock")
          .map((home) => home.id),
      ),
    [addresses],
  );
  const farmChanged = useMemo(() => {
    if (!saved) return false;
    if (saved.outreach && !saved.outreach.doorPasses) return saved.totalHomes !== currentHomeIds.size;
    const savedIds = [...saved.weeks.flatMap((week) => week.addressIds), ...(saved.unassignedAddressIds ?? [])];
    return (
      savedIds.length !== currentHomeIds.size ||
      savedIds.some((id) => !currentHomeIds.has(id))
    );
  }, [saved, currentHomeIds]);
  const changed =
    !saved || settingsKey(settings) !== settingsKey(saved) || farmChanged;
  const visits = useMemo(
    () =>
      plan
        ? annualCoverageVisits(plan, touches, outcomes)
        : new Map<string, number>(),
    [plan, touches, outcomes],
  );
  const selected = plan?.weeks.find((week) => week.startDate === selectedWeek);
  const workingWeeks = settings.weeksInPlan - settings.weeksOff.length;
  const shortfall = plan?.unassignedAddressIds.length ?? 0;
  const coverage = plan?.totalHomes ? visits.size / plan.totalHomes : 0;
  const now = new Date();
  const weeks = plan?.weeks ?? [];
  const pageCount = Math.max(1, Math.ceil(weeks.length / 8));
  const activePage = Math.min(page, pageCount - 1);
  const holidayDates = useMemo(
    () =>
      validPlanDate(settings.startDate) &&
      Number.isInteger(settings.weeksInPlan) &&
      settings.weeksInPlan > 0 &&
      settings.weeksInPlan <= 52
        ? Array.from({ length: settings.weeksInPlan }, (_, index) =>
            annualPlanDate(settings.startDate, index * 7),
          )
        : [],
    [settings.startDate, settings.weeksInPlan],
  );
  function update(next: AnnualCoverageSettings) {
    setSettings(next);
    setMessage("");
    setPage(0);
    setSelectedWeek(null);
  }
  function changeStart(startDate: string) {
    const oldDates = validPlanDate(settings.startDate)
      ? Array.from({ length: 52 }, (_, index) =>
          annualPlanDate(settings.startDate, index * 7),
        )
      : [];
    const indices = settings.weeksOff
      .map((date) => oldDates.indexOf(date))
      .filter((index) => index >= 0);
    update({
      ...settings,
      startDate,
      weeksOff: validPlanDate(startDate)
        ? indices.map((index) => annualPlanDate(startDate, index * 7))
        : [],
    });
  }
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/farms/${farmId}/annual-coverage`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Unable to save your annual plan.");
      setSaved(data.plan);
      window.dispatchEvent(new CustomEvent('flyr-farm-door-plan-refresh'));
      setSettings({
        startDate: data.plan.startDate,
        homesPerWeek: data.plan.homesPerWeek,
        weeksInPlan: data.plan.weeksInPlan,
        weeksOff: data.plan.weeksOff,
            outreach: data.plan.outreach,
      });
      setMessage("Farm plan saved. Existing touchpoints keep their dates; review them separately if your pace or rounds changed.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save your annual plan.",
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!plan) return;
    const cell = (text: string) =>
      `"${(/^[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
    const rows = [
      ["Week", "Week start", "Week end", "Address", "Farm home ID"],
      ...weeks.flatMap((week) =>
        week.addressIds.map((id) => [
          String(week.number),
          week.startDate,
          week.endDate,
          homes.get(id)?.formatted ?? "Address unavailable",
          id,
        ]),
      ),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "farm-annual-coverage.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-5">
      <section
        className={`${panel} p-5 sm:p-6`}
        aria-labelledby="annual-plan-title"
      >
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Your farm. Your pace.
        </p>
        <h2
          id="annual-plan-title"
          className="mt-2 text-xl font-semibold tracking-tight"
        >
          Annual farm coverage
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Choose your door-knocking and calling rounds, working days and time off. See exactly how much time your plan needs.
        </p>
        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Plan pace">
          <Button type="button" variant={settings.outreach ? 'secondary' : 'ghost'} aria-pressed={!!settings.outreach} disabled={loading || busy} onClick={() => update({ ...settings, outreach: settings.outreach ?? defaultOutreachSettings() })}>Daily pace</Button>
          <Button type="button" variant={!settings.outreach ? 'secondary' : 'ghost'} aria-pressed={!settings.outreach} disabled={loading || busy} onClick={() => update({ ...settings, outreach: undefined })}>Weekly target</Button>
        </div>
        <fieldset
          disabled={loading || busy}
          className="mt-6 grid min-w-0 gap-4 sm:grid-cols-3"
        >
          <div className="space-y-2">
            <Label htmlFor="annual-start">Start date</Label>
            <Input
              id="annual-start"
              type="date"
              value={settings.startDate}
              onChange={(event) => changeStart(event.target.value)}
            />
          </div>
          {!settings.outreach && <div className="space-y-2">
            <Label htmlFor="annual-target">Homes per week</Label>
            <Input
              id="annual-target"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={settings.homesPerWeek || ""}
              onChange={(event) =>
                update({
                  ...settings,
                  homesPerWeek: Number(event.target.value),
                })
              }
            />
          </div>}
          <div className="space-y-2">
            <Label htmlFor="annual-length">Plan length (weeks)</Label>
            <Input
              id="annual-length"
              type="number"
              min={1}
              max={52}
              step={1}
              value={settings.weeksInPlan || ""}
              onChange={(event) => {
                const length = Number(event.target.value);
                const allowed = new Set(holidayDates.slice(0, length));
                update({
                  ...settings,
                  weeksInPlan: length,
                  weeksOff: settings.weeksOff.filter((date) =>
                    allowed.has(date),
                  ),
                });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Up to 52 calendar weeks, including time off.
            </p>
          </div>
        </fieldset>
        {settings.outreach && <fieldset disabled={loading || busy} className="mt-6 min-w-0"><FarmOutreachQuestions value={settings.outreach} onChange={outreach => update({ ...settings, outreach, homesPerWeek: Math.max(1, outreach.doorsPerDay * outreach.workingDays.length) })} totalHomes={plan?.totalHomes ?? null} startDate={settings.startDate} weeks={settings.weeksInPlan} weeksOff={settings.weeksOff} onHolidayLoadingChange={setHolidayLoading} /></fieldset>}
        <details className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            <Palmtree className="mr-2 inline h-4 w-4 text-muted-foreground" />
            Holidays & weeks off{" "}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {settings.weeksOff.length} off · {Math.max(0, workingWeeks)}{" "}
              working weeks
            </span>
          </summary>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Tick the weeks you want free. Each block is seven days from your
            start date. Choose your own holiday weeks; none are assumed.
          </p>
          <fieldset
            disabled={loading || busy}
            className="mt-4 grid max-h-72 min-w-0 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-4"
          >
            {holidayDates.map((date, index) => (
              <label
                key={date}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-xs"
              >
                <input
                  type="checkbox"
                  aria-label={`Take week ${index + 1} off`}
                  checked={settings.weeksOff.includes(date)}
                  className="h-4 w-4 accent-[#E33449]"
                  onChange={(event) =>
                    update({
                      ...settings,
                      weeksOff: event.target.checked
                        ? [...settings.weeksOff, date].sort()
                        : settings.weeksOff.filter((value) => value !== date),
                    })
                  }
                />
                <span>
                  <span className="block font-medium">Week {index + 1}</span>
                  <span className="mt-1 block text-muted-foreground">
                    {label(date)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </details>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            disabled={
              loading ||
              loadFailed ||
              busy ||
              (settings.outreach && holidayLoading) ||
              !plan?.totalHomes ||
              (!settings.outreach && shortfall > 0) ||
              !changed
            }
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save annual plan"}
          </Button>
          {saved && (
            <Button
              variant="ghost"
              disabled={loading || busy}
              onClick={() => {
                update({
                  startDate: saved.startDate,
                  homesPerWeek: saved.homesPerWeek,
                  weeksInPlan: saved.weeksInPlan,
                  weeksOff: saved.weeksOff,
                  outreach: saved.outreach,
                });
                setError("");
              }}
            >
              Reset settings
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {loading
              ? "Loading saved plan…"
              : changed
                ? "Unsaved preview"
                : "Saved for this farm"}
          </span>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {loadFailed && (
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => void load(new AbortController().signal)}
          >
            Retry loading plan
          </Button>
        )}
        {preview.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {preview.error}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="mt-3 text-sm text-emerald-600 dark:text-emerald-400"
          >
            {message}
          </p>
        )}
        {farmChanged && (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
            Your farm homes have changed. Save again to update the weekly
            assignments.
          </p>
        )}
        {!!shortfall && !settings.outreach && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
          >
            <p className="font-medium">
              {count(shortfall)} homes won’t fit at this pace.
            </p>
            <p className="mt-1 text-muted-foreground">
              You need at least {count(plan!.minimumHomesPerWeek)} homes per
              working week to cover the farm within {settings.weeksInPlan}{" "}
              weeks.
            </p>
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              disabled={loading || busy || plan!.minimumHomesPerWeek > 10000}
              onClick={() =>
                update({ ...settings, homesPerWeek: plan!.minimumHomesPerWeek })
              }
            >
              Use {count(plan!.minimumHomesPerWeek)} homes / week
            </Button>
          </div>
        )}
      </section>
      {plan && (
        <>
          <section
            className={`${panel} p-5 sm:p-6`}
            aria-labelledby="annual-progress-title"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2
                  id="annual-progress-title"
                  className="text-lg font-semibold"
                >
                  Your year at a glance
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  First-pass door assignments and recorded visits. Extra door rounds and call goals are included in your pace summary.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {label(plan.startDate)} –{" "}
                {label(
                  annualPlanDate(plan.startDate, plan.weeksInPlan * 7 - 1),
                )}
              </span>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-5 lg:grid-cols-4">
              {[
                ["Farm homes", count(plan.totalHomes), "Unique eligible homes"],
                [
                  "Homes visited",
                  count(visits.size),
                  `${(coverage * 100).toFixed(1)}% of the farm`,
                ],
                [
                  "Working weeks",
                  count(workingWeeks),
                  `${settings.weeksOff.length} holiday weeks off`,
                ],
                [
                  "Planned finish",
                  plan.finishDate ? label(plan.finishDate) : "Target too low",
                  plan.finishDate
                    ? `${plan.weeks.filter((week) => week.addressIds.length).length} weeks with assignments`
                    : "Increase your weekly target",
                ],
              ].map(([title, value, hint]) => (
                <div key={title}>
                  <p className="text-xs text-muted-foreground">{title}</p>
                  <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">
                    {value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
                </div>
              ))}
            </div>
            <div
              className="mt-5 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Annual farm coverage"
              aria-valuenow={Math.round(coverage * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-[#E33449] transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${coverage * 100}%` }}
              />
            </div>
            <AnnualCoverageChart plan={plan} visits={visits} now={now} />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Actual progress counts each home once from recorded door activity
              in this plan’s date range. A scheduled visit does not count as
              completed.
              {plan.excludedDoNotKnock
                ? ` ${count(plan.excludedDoNotKnock)} do-not-knock homes excluded.`
                : ""}
            </p>
          </section>
          <section
            className={`${panel} p-5 sm:p-6`}
            aria-labelledby="annual-weeks-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="annual-weeks-title" className="text-lg font-semibold">
                  Weekly home assignments
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  One assignment per home, grouped by street.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!plan.totalHomes}
                onClick={download}
              >
                <Download className="mr-2 h-4 w-4" />
                Export weekly lists
              </Button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {weeks.slice(activePage * 8, activePage * 8 + 8).map((week) => {
                const visited = week.addressIds.filter((id) =>
                  visits.has(id),
                ).length;
                return (
                  <button
                    key={week.startDate}
                    type="button"
                    disabled={week.isOff || !week.addressIds.length}
                    aria-pressed={selectedWeek === week.startDate}
                    aria-label={`Week ${week.number}: ${week.isOff ? "time off" : `${week.addressIds.length} homes`}`}
                    onClick={() => {
                      setSelectedWeek(week.startDate);
                      setHomeLimit(25);
                    }}
                    className="rounded-xl border border-border p-4 text-left transition-colors hover:bg-muted/30 aria-pressed:border-primary disabled:cursor-default disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">Week {week.number}</span>
                      {week.isOff ? (
                        <Palmtree className="h-4 w-4 text-muted-foreground" />
                      ) : visited === week.addressIds.length && visited > 0 ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {label(week.startDate)}
                    </p>
                    <p className="mt-3 text-xl font-semibold">
                      {week.isOff
                        ? "Time off"
                        : week.addressIds.length
                          ? `${count(week.addressIds.length)} homes`
                          : "No homes assigned"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {week.addressIds.length
                        ? `${visited} visited so far · View homes`
                        : week.isOff
                          ? "No visits planned"
                          : "Your farm is allocated in earlier weeks"}
                    </p>
                  </button>
                );
              })}
            </div>
            {!plan.totalHomes && (
              <p className="mt-4 text-sm text-muted-foreground">
                Add farm homes to create weekly assignments.
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={activePage === 0}
                onClick={() => setPage(activePage - 1)}
              >
                Previous weeks
              </Button>
              <span className="text-xs text-muted-foreground">
                Weeks {activePage * 8 + 1}–
                {Math.min(activePage * 8 + 8, weeks.length)} of {weeks.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={activePage + 1 >= pageCount}
                onClick={() => setPage(activePage + 1)}
              >
                Next weeks
              </Button>
            </div>
            {selected && (
              <div className="mt-5 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Week {selected.number} · {label(selected.startDate)} –{" "}
                    {label(selected.endDate)}
                  </h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedWeek(null)}
                  >
                    Close home list
                  </Button>
                </div>
                <div className="mt-3 max-h-96 overflow-y-auto">
                  {selected.addressIds.slice(0, homeLimit).map((id) => {
                    const home = homes.get(id);
                    return (
                      <div
                        key={id}
                        className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <Home className="mr-2 inline h-3 w-3 text-muted-foreground" />
                          {home?.formatted ?? "Address unavailable"}
                          {visits.has(id) && (
                            <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">
                              Visited
                            </span>
                          )}
                        </div>
                        {home && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onAddContact(home)}
                          >
                            Add contact
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {selected.addressIds.length > homeLimit && (
                    <Button
                      className="mt-3"
                      variant="outline"
                      size="sm"
                      onClick={() => setHomeLimit(homeLimit + 25)}
                    >
                      Show more homes
                    </Button>
                  )}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function AnnualCoverageChart({
  plan,
  visits,
  now,
}: {
  plan: AnnualCoveragePlan;
  visits: Map<string, number>;
  now: Date;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(260, entry.contentRect.width)),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const start = new Date(`${plan.startDate}T00:00:00`).getTime();
  const end = new Date(
    `${annualPlanDate(plan.startDate, plan.weeksInPlan * 7)}T00:00:00`,
  ).getTime();
  const at = Math.min(end, Math.max(start, now.getTime()));
  const x = (time: number) =>
    42 + ((time - start) / (end - start)) * (width - 60);
  const y = (value: number) =>
    224 - (value / Math.max(1, plan.totalHomes)) * 180;
  let cumulative = 0;
  const planned = [
    [42, y(0)],
    ...plan.weeks.map((week) => {
      cumulative += week.addressIds.length;
      return [
        x(new Date(`${annualPlanDate(week.startDate, 7)}T00:00:00`).getTime()),
        y(cumulative),
      ];
    }),
  ];
  const recorded = [...visits.values()].sort((a, b) => a - b);
  let visited = 0;
  const actual: number[][] = [[42, y(0)]];
  for (const week of plan.weeks) {
    const point = Math.min(
      at,
      new Date(`${annualPlanDate(week.startDate, 7)}T00:00:00`).getTime(),
    );
    while (visited < recorded.length && recorded[visited] <= point) visited++;
    actual.push([x(point), y(visited)]);
    if (point === at) break;
  }
  return (
    <div ref={ref} className="mt-6">
      <div className="mb-3 flex gap-5 text-xs text-muted-foreground">
        <span>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#E33449]" />
          Visited
        </span>
        <span>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-muted-foreground" />
          Planned
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} 260`}
        className="h-auto w-full"
        role="img"
        aria-label={`Annual farm coverage: ${visits.size} of ${plan.totalHomes} homes visited; ${plan.totalHomes - plan.unassignedAddressIds.length} homes assigned across ${plan.weeksInPlan} weeks.`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line
              x1={42}
              x2={width - 18}
              y1={y(tick * plan.totalHomes)}
              y2={y(tick * plan.totalHomes)}
              stroke="currentColor"
              className="text-border"
            />
            <text
              x={32}
              y={y(tick * plan.totalHomes) + 4}
              textAnchor="end"
              fontSize={11}
              fill="currentColor"
              className="text-muted-foreground"
            >
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}
        <polyline
          points={planned.map((point) => point.join(",")).join(" ")}
          fill="none"
          stroke="currentColor"
          className="text-muted-foreground"
          strokeWidth={2}
          strokeDasharray="5 5"
        />
        <polyline
          points={actual.map((point) => point.join(",")).join(" ")}
          fill="none"
          stroke="#E33449"
          strokeWidth={3}
          strokeLinejoin="round"
        />
        {Array.from({ length: width < 500 ? 3 : 5 }, (_, index) => {
          const fraction = index / (width < 500 ? 2 : 4);
          return (
            <text
              key={index}
              x={42 + fraction * (width - 60)}
              y={250}
              textAnchor={
                fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"
              }
              fontSize={11}
              fill="currentColor"
              className="text-muted-foreground"
            >
              W{Math.max(1, Math.round(fraction * plan.weeksInPlan))}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
