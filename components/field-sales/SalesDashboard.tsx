"use client";
import { ProSalesDashboard } from "./ProSalesDashboard";
import { ProSalesLeaderboard } from "./ProSalesLeaderboard";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useFieldSales,
  salesCommand,
  money,
  minorUnits,
  type SalesData,
  type Sale,
} from "@/lib/field-sales/client";
import { SalesHistory, downloadSalesCSV } from "./SalesReports";
const input = "rounded-lg border border-input bg-background px-3 py-2 w-full";
const button =
  "rounded-lg bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50";
export function SalesDashboard({
  leaderboardOnly = false,
}: {
  leaderboardOnly?: boolean;
}) {
  const scope = useFieldSales({}, true);
  if (!scope.data?.enabled)
    return scope.error ? (
      <p>
        Sales unavailable. <button onClick={scope.refresh}>Retry</button>
      </p>
    ) : (
      <p>
        {scope.loading
          ? "Loading Sales…"
          : "Sales is not enabled for this workspace."}
      </p>
    );
  if (leaderboardOnly && scope.data.pro_sales_version) return <ProSalesLeaderboard/>;
  if (scope.data.pro_sales_version && scope.data.currency && scope.data.timezone && !scope.data.needs_setup) return <ProSalesDashboard key={`${scope.workspaceId}:${scope.data.user_id}`} workspace={scope.workspaceId!} settings={scope.data.role === "owner" || scope.data.role === "admin" ? <SalesSettings d={scope.data} workspace={scope.workspaceId!} /> : undefined} />;
  return (
    <SalesDashboardContent
      key={`${scope.workspaceId}:${scope.data.user_id}`}
      leaderboardOnly={leaderboardOnly}
    />
  );
}
function SalesDashboardContent({
  leaderboardOnly,
}: {
  leaderboardOnly: boolean;
}) {
  const search = useSearchParams();
  const [period, setPeriod] = useState("month");
  const [team, setTeam] = useState(false);
  const [rep, setRep] = useState("");
  const [campaign, setCampaign] = useState("");
  const [status, setStatus] = useState("");
  const [ranking, setRanking] = useState("sales");
  const {
    data: d,
    error,
    loading,
    refresh,
    workspaceId,
  } = useFieldSales({ period, team, rep, campaign, status });
  const [edit, setEdit] = useState<Sale | null>(null);
  const [recording, setRecording] = useState(!!search.get("lead"));
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<Sale | null>(null);
  const [reason, setReason] = useState("");
  async function review(action: string, sale: Sale) {
    if (!workspaceId) return;
    setBusy(true);
    setFailure("");
    try {
      await salesCommand(workspaceId, action, {
        id: sale.id,
        version: sale.version,
        reason,
      });
      setCancelling(null);
      setReason("");
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <div role="alert">
        {error} <button onClick={refresh}>Retry</button>
      </div>
    );
  if (!d)
    return (
      <p>{loading ? "Loading Sales…" : "Select a workspace to view Sales."}</p>
    );
  if (!d.enabled) return <p>Sales is not enabled for this workspace.</p>;
  if (d.needs_setup)
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Set up Sales · Beta</h1>
        {d.role === "owner" ? (
          <SalesSettings d={d} workspace={workspaceId!} />
        ) : (
          <p>An owner must select the reporting currency and timezone.</p>
        )}
      </div>
    );
  const managers = ["owner", "admin"].includes(d.role);
  const visibleRanking =
    ranking === "revenue" &&
    d.ranking.some((r) => r.revenue_minor !== undefined)
      ? "revenue"
      : "sales";
  const ranks = [...d.ranking].sort((a, b) =>
    visibleRanking === "sales"
      ? b.sales - a.sales
      : Number(BigInt(b.revenue_minor ?? "0") - BigInt(a.revenue_minor ?? "0")),
  );
  return (
    <div
      className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6"
      key={`${workspaceId}:${d.user_id}`}
    >
      <Link className="underline" href="/sales/opportunities">
        Pipeline & follow-ups · Beta →
      </Link>
      {d.pro_sales_version ? <><Link className="ml-4 underline" href="/sales/reports">Performance reports →</Link><Link className="ml-4 underline" href="/sales/goals">Goals & pace →</Link></> : null}
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">
            {leaderboardOnly ? "Sales leaderboard · Beta" : "Sales · Beta"}
          </h1>
          <p className="text-muted-foreground text-sm">
            Verified contract value · {d.currency} · {d.timezone}
            <br />
            {d.period_start} – {d.period_end}
          </p>
        </div>
        {!leaderboardOnly && (
          <button
            className={button}
            onClick={() => {
              setEdit(null);
              setRecording(true);
            }}
          >
            Convert appointment · Beta
          </button>
        )}
      </header>
      <div className="flex flex-wrap gap-3">
        <button className={button} onClick={() => downloadSalesCSV(d)}>
          Export displayed sales · Beta
        </button>
        <label>
          Period
          <select
            className={input}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="previous_week">Last week</option>
            <option value="previous_month">Last month</option>
            <option value="quarter">This quarter</option>
            <option value="year">This year</option>
          </select>
        </label>
        {!leaderboardOnly && (
          <>
            <label>
              View
              <select
                className={input}
                value={team ? "team" : "personal"}
                onChange={(e) => {
                  setTeam(e.target.value === "team");
                  setRep("");
                }}
              >
                <option value="personal">My sales</option>
                <option value="team">Team sales</option>
              </select>
            </label>
            {team && (
              <label>
                Representative
                <select
                  className={input}
                  value={rep}
                  onChange={(e) => setRep(e.target.value)}
                >
                  <option value="">All representatives</option>
                  {d.ranking.map((r) => (
                    <option key={r.rep_id} value={r.rep_id}>
                      {r.rep_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Status
              <select
                className={input}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {["pending", "verified", "cancelled"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          Campaign
          <select
            className={input}
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
          >
            <option value="">All campaigns</option>
            {d.options.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {managers && !leaderboardOnly && (
          <button
            className="underline"
            onClick={() => {
              setTeam(true);
              setRep("");
              setStatus("pending");
            }}
          >
            Review pending sales
          </button>
        )}
      </div>
      {!leaderboardOnly && (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            <Stat label="Verified sales" value={String(d.totals.sales)} />
            <Stat
              label="Verified contract value"
              value={money(d.totals.revenue_minor, d.currency)}
            />
            <Stat
              label="Monthly target"
              value={
                d.goal.target
                  ? `${d.goal.completed} / ${d.goal.target}`
                  : "Not set"
              }
            />
          </div>
          <section className="rounded-2xl bg-muted p-5">
            <h2 className="font-semibold">Wolfy’s next step</h2>
            <p>{d.coaching}</p>
            <p className="text-sm mt-3">
              Period activity: {d.metrics.doors} doors →{" "}
              {d.metrics.conversations} conversations → {d.metrics.leads} new
              leads → {d.metrics.appointments} elapsed appointments.{" "}
              {d.totals.sales} verified sales.
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mt-3">
              <p>
                Sales per 100 doors:{" "}
                {d.metrics.sales_per_100_doors ?? "Unavailable"}{" "}
                <small>(production ratio)</small>
              </p>
              <p>
                Lead cohort: {ratio(d.metrics.lead_converted, d.metrics.leads)}
              </p>
              <p>
                Appointment cohort:{" "}
                {ratio(d.metrics.appointment_converted, d.metrics.appointments)}
              </p>
            </div>
            {d.metrics.unlinked_sales > 0 && (
              <p className="text-sm">
                {d.metrics.unlinked_sales} sales have no linked appointment.
                Appointment conversion is unavailable.
              </p>
            )}
            <p className="text-xs mt-2">
              Cohorts follow source records in this period through conversion.
              As of {new Date(d.as_of).toLocaleString()}.
            </p>
          </section>
          <GoalEditor
            key={`${team}:${rep}:${d.month}`}
            d={d}
            workspace={workspaceId!}
            rep={team ? rep || null : d.user_id}
          />
          {failure && (
            <p role="alert" className="text-destructive">
              {failure}
            </p>
          )}
          {cancelling && (
            <section className="border rounded-xl p-4 space-y-3">
              <h2>Cancel sale from {cancelling.sold_on}</h2>
              <label>
                Reason
                <textarea
                  className={input}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                className={button}
                disabled={busy || !reason.trim()}
                onClick={() => review("cancel", cancelling)}
              >
                Confirm cancellation
              </button>{" "}
              <button onClick={() => setCancelling(null)}>Keep sale</button>
            </section>
          )}
          {(recording || edit) && (
            <SaleEditor
              key={`${workspaceId}:${d.user_id}:${edit?.id ?? "new"}`}
              d={d}
              workspace={workspaceId!}
              initial={edit}
              lead={search.get("lead") ?? ""}
              close={() => {
                setEdit(null);
                setRecording(false);
              }}
            />
          )}
          <section className="space-y-3">
            <h2 className="font-semibold">
              {status === "pending" ? "Pending verification" : "Recent sales"}
            </h2>
            {!d.sales.length && <p>No sales match these filters.</p>}
            {d.sales.map((s) => (
              <article
                key={s.id}
                className="rounded-xl border p-4 flex flex-wrap justify-between gap-3"
              >
                <div>
                  <strong>{s.rep_name}</strong> · {s.status}
                  <p>
                    {s.sold_on} · {money(s.value_minor, s.currency)}
                  </p>
                  <small>
                    Campaign:{" "}
                    {d.options.campaigns.find((c) => c.id === s.campaign_id)
                      ?.name ?? "Unassigned"}
                    {s.territory_id ? ` · Territory ${s.territory_id}` : ""}
                  </small>
                  {s.notes && <p>{s.notes}</p>}
                  {(managers || s.contact_id) && (
                    <SalesHistory
                      workspace={workspaceId!}
                      sale={s.id}
                      version={s.version}
                    />
                  )}
                  {d.pro_sales_version && (managers || s.contact_id) && <Link className="mt-2 inline-block text-sm underline" href={`/sales/${s.id}`}>Sale details & payments</Link>}
                  {s.cancellation_reason && (
                    <p>Reason: {s.cancellation_reason}</p>
                  )}
                </div>
                <div className="flex gap-3 items-center">
                  {s.can_edit && (
                    <button
                      onClick={() => {
                        setRecording(false);
                        setEdit(s);
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {s.can_verify && (
                    <button
                      disabled={busy}
                      className={button}
                      onClick={() => review("verify", s)}
                    >
                      Verify
                    </button>
                  )}
                  {s.can_cancel && (
                    <button disabled={busy} onClick={() => setCancelling(s)}>
                      Cancel
                    </button>
                  )}
                  {s.status === "cancelled" && s.contact_id && (
                    <button
                      onClick={() => {
                        setEdit({ ...s, status: "replacement" });
                        setRecording(false);
                      }}
                    >
                      Record replacement
                    </button>
                  )}
                </div>
              </article>
            ))}
            {d.sales.length === d.list_limit && (
              <p>
                Showing the latest {d.list_limit} sales. Narrow the filters to
                find older records.
              </p>
            )}
          </section>
        </>
      )}
      {d.pro_sales_version ? <ProSalesLeaderboard embedded/> : <section className="rounded-xl border p-4 space-y-3">
        <h2 className="font-semibold">Team leaderboard · Beta</h2>
        <label>
          Category
          <select
            className={input}
            value={visibleRanking}
            onChange={(e) => setRanking(e.target.value)}
          >
            <option value="sales">Sales · Beta</option>
            {d.ranking.some((r) => r.revenue_minor !== undefined) && (
              <option value="revenue">Revenue · Beta</option>
            )}
          </select>
        </label>
        {ranks.map((r, i) => (
          <div key={r.rep_id} className="flex justify-between border-b py-2">
            <span>
              {i + 1}. {r.rep_name}
            </span>
            <strong>
              {visibleRanking === "sales"
                ? `${r.sales} sales`
                : money(r.revenue_minor, d.currency)}
            </strong>
          </div>
        ))}
      </section>}
      {!leaderboardOnly && (
        <>
          <section>
            <h2 className="font-semibold">Recent team wins · Beta</h2>
            {d.feed.map((f) => (
              <p key={f.id} className="py-2">
                {f.rep_name} recorded a verified sale · {f.sold_on}
                {f.value_minor !== undefined
                  ? ` · ${money(f.value_minor, d.currency)}`
                  : ""}
              </p>
            ))}
          </section>
          {managers && (
            <details>
              <summary>Sales settings · Beta</summary>
              <SalesSettings d={d} workspace={workspaceId!} />
            </details>
          )}
        </>
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-xl p-4">
      <p className="text-muted-foreground">{label}</p>
      <strong className="text-2xl">{value}</strong>
    </div>
  );
}
function ratio(n: number | null, d: number) {
  return n === null || d === 0
    ? "Unavailable"
    : `${n} / ${d} (${Math.round((n / d) * 100)}%)`;
}
function SalesSettings({ d, workspace }: { d: SalesData; workspace: string }) {
  const [currency, setCurrency] = useState(d.currency ?? "");
  const [timezone, setTimezone] = useState(d.timezone ?? "");
  const [visible, setVisible] = useState(d.team_revenue_visible);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3 mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await salesCommand(workspace, "settings", {
            currency,
            timezone,
            team_revenue_visible: visible,
          });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Reporting currency
        <select
          required
          className={input}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          <option value="">Select currency</option>
          {["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "JPY", "CHF"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Reporting timezone
        <input
          required
          className={input}
          placeholder="America/Toronto"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
      </label>
      <p className="text-xs">
        Currency and timezone lock after the first sale.
      </p>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
        Show revenue and contract values to teammates
      </label>
      {error && <p role="alert">{error}</p>}
      <button className={button} disabled={busy}>
        Save settings
      </button>
    </form>
  );
}
function GoalEditor({
  d,
  workspace,
  rep,
}: {
  d: SalesData;
  workspace: string;
  rep: string | null;
}) {
  const [target, setTarget] = useState(d.goal.target?.toString() ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (
    (rep !== null && rep !== d.user_id) ||
    (rep === null && !["owner", "admin"].includes(d.role))
  )
    return null;
  return (
    <form
      className="flex flex-wrap gap-3 items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await salesCommand(workspace, "goal", {
            rep_id: rep,
            month: d.month,
            target: target ? Number(target) : null,
          });
          setError("");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {rep ? "Personal" : "Team"} monthly sales target
        <input
          type="number"
          min="1"
          max="1000000"
          className={input}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </label>
      <button disabled={busy} className={button}>
        Save target
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function SaleEditor({
  d,
  workspace,
  initial,
  lead,
  close,
}: {
  d: SalesData;
  workspace: string;
  initial: Sale | null;
  lead: string;
  close: () => void;
}) {
  const [contact, setContact] = useState(initial?.contact_id ?? lead);
  const [rep, setRep] = useState(initial?.rep_id ?? d.user_id);
  const [appointment, setAppointment] = useState(initial?.appointment_id ?? "");
  const [value, setValue] = useState(
    initial?.value_minor
      ? d.currency === "JPY"
        ? initial.value_minor
        : `${BigInt(initial.value_minor) / BigInt(100)}.${(BigInt(initial.value_minor) % BigInt(100)).toString().padStart(2, "0")}`
      : "",
  );
  const [date, setDate] = useState(initial?.sold_on ?? d.today);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="rounded-xl border p-5 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await salesCommand(
            workspace,
            initial?.id && initial.status !== "replacement" ? "edit" : "submit",
            {
              id: initial?.id,
              version: initial?.version,
              request_id: requestId,
              replaces_id:
                initial?.status === "replacement" ? initial.id : null,
              contact_id: contact,
              rep_id: rep,
              appointment_id: appointment || null,
              value_minor: minorUnits(value, d.currency!),
              sold_on: date,
              notes,
            },
          );
          close();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-semibold">
        {initial?.id && initial.status !== "replacement"
          ? "Edit pending sale"
          : "Convert appointment"}
      </h2>
      <label>
        Existing lead
        <select
          required
          className={input}
          value={contact}
          onChange={(e) => {
            setContact(e.target.value);
            setAppointment("");
          }}
        >
          <option value="">Select lead</option>
          {d.options.leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm">
        Campaign:{" "}
        {d.options.campaigns.find(
          (c) =>
            c.id === d.options.leads.find((l) => l.id === contact)?.campaign_id,
        )?.name ?? "Unassigned"}{" "}
        · Territory follows the campaign.
      </p>
      <label>
        Representative
        <select
          required
          className={input}
          disabled={d.role === "member"}
          value={rep}
          onChange={(e) => setRep(e.target.value)}
        >
          {d.ranking.map((r) => (
            <option key={r.rep_id} value={r.rep_id}>
              {r.rep_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Appointment (required)
        <select
          className={input}
          value={appointment}
          onChange={(e) => setAppointment(e.target.value)}
        >
          <option value="">Select appointment</option>
          {d.options.appointments
            .filter((a) => a.contact_id === contact)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {new Date(a.scheduled_at).toLocaleString()}
              </option>
            ))}
        </select>
      </label>
      <label>
        Contract value ({d.currency})
        <input
          required
          inputMode="decimal"
          className={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <label>
        Sale date
        <input
          required
          type="date"
          max={d.today}
          className={input}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label>
        Notes
        <textarea
          className={input}
          maxLength={4000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <p className="text-sm">
        Pending until verified by an authorized manager.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <button className={button} disabled={busy || !appointment}>
        Save sale
      </button>{" "}
      <button type="button" onClick={close} disabled={busy}>
        Close
      </button>
    </form>
  );
}
