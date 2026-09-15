"use client";
import Link from "next/link";
import { useState } from "react";
import {
  useFieldSales,
  salesCommand,
  money,
  minorUnits,
  decimalFromMinor,
} from "@/lib/field-sales/client";
type Stage = {
  key: string;
  label: string;
  kind: string;
  position: number;
  probability: number;
};
type Opportunity = {
  contact_id: string;
  contact_name: string;
  stage_key: string;
  expected_value_minor?: string;
  expected_close?: string;
  notes: string;
  version: number;
};
type Task = {
  id: string;
  contact_id: string;
  contact_name: string;
  title: string;
  kind: string;
  due_at: string;
  status: string;
  version: number;
};
type Workbench = {
  enabled: boolean;
  needs_setup?: boolean;
  user_id: string;
  role: string;
  currency: string;
  timezone: string;
  stages: Stage[];
  opportunities: Opportunity[];
  tasks: Task[];
  summary: {
    key: string;
    label: string;
    kind: string;
    count: number;
    value_minor?: string;
    weighted_minor?: string;
    missing_values: number;
  }[];
  leads: { id: string; name: string }[];
};
const input = "w-full rounded-lg border bg-background p-2";
const button = "rounded-lg border px-3 py-2 hover:bg-muted disabled:opacity-50";
export function SalesWorkbench() {
  const scope = useFieldSales({}, true);
  if (!scope.data?.enabled)
    return <p>Sales · Beta is unavailable for this workspace.</p>;
  return (
    <WorkbenchContent key={`${scope.workspaceId}:${scope.data.user_id}`} />
  );
}
function WorkbenchContent() {
  const {
    data: d,
    error,
    workspaceId,
    refresh,
  } = useFieldSales<Workbench>({}, false, "field_sales_workbench");
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [creating, setCreating] = useState(false);
  const [tasking, setTasking] = useState(false);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskFilter, setTaskFilter] = useState("pending");
  async function command(action: string, data: Record<string, unknown>) {
    if (!workspaceId) return;
    setFailure("");
    setBusy(true);
    try {
      await salesCommand(
        workspaceId,
        action,
        data,
        "field_sales_pipeline_command",
      );
      return true;
    } catch (e) {
      setFailure((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <p role="alert">
        {error} <button onClick={refresh}>Retry</button>
      </p>
    );
  if (!d) return <p>Loading pipeline · Beta…</p>;
  if (!d.enabled || d.needs_setup)
    return <Link href="/sales">Set up Sales · Beta first</Link>;
  return (
    <main className="mx-auto max-w-7xl p-5 space-y-6">
      <Link href="/sales" className="underline">
        ← Verified Sales · Beta
      </Link>
      <header>
        <h1 className="text-2xl font-bold">Pipeline & follow-ups · Beta</h1>
        <p className="text-muted-foreground">
          Expected pipeline value is an estimate. Only a separately verified
          sale earns revenue and leaderboard credit.
        </p>
      </header>
      <section className="space-y-3">
        <h2 className="font-semibold">Team pipeline · Beta</h2>
        <div className="flex gap-3 overflow-x-auto">
          {d.summary.map((s) => (
            <div key={s.key} className="min-w-40 rounded-xl border p-3">
              <h3>{s.label}</h3>
              <strong>{s.count} opportunities</strong>
              {s.value_minor !== undefined && (
                <>
                  <p>{money(s.value_minor, d.currency)} known value</p>
                  <small>
                    {money(s.weighted_minor, d.currency)} weighted estimate
                  </small>
                </>
              )}
              {s.missing_values > 0 && (
                <p className="text-xs">{s.missing_values} values unavailable</p>
              )}
            </div>
          ))}
        </div>
      </section>
      <div className="flex gap-3">
        <button
          className={button}
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          Add opportunity · Beta
        </button>
        <button className={button} onClick={() => setTasking(true)}>
          Add follow-up · Beta
        </button>
      </div>
      {failure && (
        <p role="alert" className="text-destructive">
          {failure}
        </p>
      )}
      {(creating || editing) && (
        <OpportunityForm
          key={editing?.contact_id ?? "new"}
          d={d}
          initial={editing}
          busy={busy}
          save={async (data) => {
            if (await command("opportunity", data)) {
              setCreating(false);
              setEditing(null);
            }
          }}
          close={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {tasking && (
        <TaskForm
          d={d}
          busy={busy}
          save={async (data) => {
            if (await command("task", data)) setTasking(false);
          }}
          close={() => setTasking(false)}
        />
      )}
      <section>
        <h2 className="font-semibold mb-3">My opportunities · Beta</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {d.stages.map((stage) => (
            <section
              className="rounded-xl border p-3 space-y-3"
              key={stage.key}
            >
              <h3 className="font-semibold">{stage.label}</h3>
              {d.opportunities
                .filter((o) => o.stage_key === stage.key)
                .map((o) => (
                  <article
                    className="rounded-lg bg-muted p-3 space-y-2"
                    key={o.contact_id}
                  >
                    <strong>{o.contact_name}</strong>
                    <p>
                      {o.expected_value_minor != null
                        ? money(o.expected_value_minor, d.currency)
                        : "Value unavailable"}
                    </p>
                    {o.expected_close && (
                      <p>Expected close: {o.expected_close}</p>
                    )}
                    <button
                      className={button}
                      onClick={() => {
                        setCreating(false);
                        setEditing(o);
                      }}
                    >
                      Edit
                    </button>
                    {stage.kind === "won" && (
                      <Link
                        className="block underline"
                        href={`/sales?lead=${o.contact_id}`}
                      >
                        Record Sale · Beta
                      </Link>
                    )}
                  </article>
                ))}
            </section>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">My follow-ups · Beta</h2>
        <label>
          Show{" "}
          <select
            className={input}
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value)}
          >
            <option value="pending">Pending</option>
            <option value="done">Completed in last 30 days</option>
          </select>
        </label>
        {d.tasks
          .filter((t) => t.status === taskFilter)
          .map((t) => (
            <article
              key={t.id}
              className="rounded-xl border p-3 flex justify-between gap-3"
            >
              <div>
                <strong>{t.title}</strong>
                <p>
                  {t.contact_name} · {t.kind}
                </p>
                <p>
                  {new Date(t.due_at).toLocaleString()}{" "}
                  {t.status === "pending" && Date.parse(t.due_at) < Date.now()
                    ? "· Overdue"
                    : ""}
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    command("task_status", {
                      id: t.id,
                      version: t.version,
                      status: t.status === "done" ? "pending" : "done",
                    })
                  }
                >
                  {t.status === "done" ? "Reopen" : "Complete"}
                </button>
                {t.status === "pending" && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      command("task_status", {
                        id: t.id,
                        version: t.version,
                        status: "cancelled",
                      })
                    }
                  >
                    Cancel
                  </button>
                )}
              </div>
            </article>
          ))}
      </section>
      {["owner", "admin"].includes(d.role) && (
        <details className="rounded-xl border p-4">
          <summary>Pipeline stages · Beta</summary>
          <p className="text-sm my-2">
            Probabilities weight estimates; they do not predict outcomes.
          </p>
          {d.stages.map((stage) => (
            <StageForm
              key={`${stage.key}:${stage.label}:${stage.probability}:${stage.position}:${stage.kind}`}
              initial={stage}
              busy={busy}
              save={(data) => command("stage", data)}
            />
          ))}
          <StageForm busy={busy} save={(data) => command("stage", data)} />
        </details>
      )}
    </main>
  );
}
function OpportunityForm({
  d,
  initial,
  busy,
  save,
  close,
}: {
  d: Workbench;
  initial: Opportunity | null;
  busy: boolean;
  save: (data: Record<string, unknown>) => Promise<void>;
  close: () => void;
}) {
  const [contact, setContact] = useState(
    initial?.contact_id ?? d.leads[0]?.id ?? "",
  );
  const [stage, setStage] = useState(
    initial?.stage_key ?? d.stages[0]?.key ?? "",
  );
  const [amount, setAmount] = useState(
    decimalFromMinor(initial?.expected_value_minor, d.currency),
  );
  const [date, setDate] = useState(initial?.expected_close ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");
  return (
    <form
      className="rounded-xl border p-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          setError("");
          await save({
            contact_id: contact,
            stage_key: stage,
            expected_value_minor: amount
              ? Number(amount) === 0
                ? "0"
                : minorUnits(amount, d.currency)
              : null,
            expected_close: date || null,
            notes,
            version: initial?.version,
          });
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <h2>Opportunity · Beta</h2>
      <label>
        Lead
        <select
          className={input}
          value={contact}
          disabled={!!initial}
          onChange={(e) => setContact(e.target.value)}
        >
          {d.leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Stage
        <select
          className={input}
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          {d.stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Expected value ({d.currency}, optional)
        <input
          className={input}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        Expected close (optional)
        <input
          className={input}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label>
        Notes
        <textarea
          className={input}
          value={notes}
          maxLength={4000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className={button} disabled={busy || !contact}>
        Save opportunity
      </button>{" "}
      <button className={button} type="button" onClick={close}>
        Close
      </button>
    </form>
  );
}
function TaskForm({
  d,
  busy,
  save,
  close,
}: {
  d: Workbench;
  busy: boolean;
  save: (data: Record<string, unknown>) => Promise<void>;
  close: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [contact, setContact] = useState(d.leads[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("call");
  const [due, setDue] = useState("");
  return (
    <form
      className="rounded-xl border p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save({
          id,
          contact_id: contact,
          title,
          kind,
          due_at: new Date(due).toISOString(),
        });
      }}
    >
      <h2>Follow-up · Beta</h2>
      <label>
        Lead
        <select
          className={input}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        >
          {d.leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Task
        <input
          className={input}
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Type
        <select
          className={input}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {["call", "email", "text", "visit", "task"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        Due (your device timezone)
        <input
          className={input}
          required
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <button className={button} disabled={busy || !contact}>
        Save follow-up
      </button>{" "}
      <button className={button} type="button" onClick={close}>
        Close
      </button>
    </form>
  );
}
function StageForm({
  initial,
  busy,
  save,
}: {
  initial?: Stage;
  busy: boolean;
  save: (data: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [probability, setProbability] = useState(initial?.probability ?? 0);
  const [position, setPosition] = useState(initial?.position ?? 6);
  const [kind, setKind] = useState(initial?.kind ?? "open");
  const [key] = useState(
    initial?.key ??
      `stage_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
  );
  return (
    <form
      className="flex flex-wrap gap-2 my-3 items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          (await save({ key, label, probability, position, kind })) &&
          !initial
        )
          setLabel("");
      }}
    >
      <label>
        Stage name
        <input
          className={input}
          required
          maxLength={60}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label>
        Probability %
        <input
          className={input}
          type="number"
          min={0}
          max={100}
          required
          value={probability}
          onChange={(e) => setProbability(Number(e.target.value))}
        />
      </label>
      <label>
        Order
        <input
          className={input}
          type="number"
          min={0}
          max={100}
          required
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
      </label>
      <label>
        Outcome
        <select
          className={input}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {["open", "won", "lost"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <button className={button} disabled={busy}>
        {initial ? "Save stage" : "Add stage"}
      </button>
    </form>
  );
}
