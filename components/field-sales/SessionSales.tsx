"use client";

import { money, useFieldSales } from "@/lib/field-sales/client";

type SessionSummary = {
  enabled: boolean;
  verified_sales: number;
  appointments_set: number;
  appointments_closed: number;
  currency?: string;
  value_minor?: string;
  value_scope?: "session" | "self";
};

export function SessionSales({ sessionId }: { sessionId: string }) {
  return <SessionSalesContent key={sessionId} sessionId={sessionId} />;
}

function SessionSalesContent({ sessionId }: { sessionId: string }) {
  const { data } = useFieldSales<SessionSummary>({}, false, "field_sales_session_summary", undefined, sessionId);
  if (!data?.enabled) return null;

  return (
    <section className="space-y-2 rounded-xl border bg-card p-4" aria-label="Session Sales">
      <h4 className="text-sm font-semibold">Session Sales</h4>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <SessionMetric label="Appointments set" value={data.appointments_set} />
        <SessionMetric label="Appointments closed" value={data.appointments_closed} />
        <SessionMetric label="Verified sales" value={data.verified_sales} />
        {data.value_minor !== undefined && data.currency && (
          <SessionMetric label={data.value_scope === "self" ? "Credited contract value" : "Verified contract value"}
            value={money(data.value_minor, data.currency)} />
        )}
      </dl>
    </section>
  );
}

function SessionMetric({ label, value }: { label: string; value: string | number }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>;
}
