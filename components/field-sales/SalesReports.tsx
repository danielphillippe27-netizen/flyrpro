"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money, type SalesData } from "@/lib/field-sales/client";
type Event = {
  id: string;
  action: string;
  actor: string;
  created_at: string;
  status: string;
  value_minor: string;
  currency: string;
  sold_on: string;
  version: number;
  reason?: string;
};
export function SalesHistory({
  workspace,
  sale,
  version,
}: {
  workspace: string;
  sale: string;
  version: number;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setEvents([]);
    setError("");
    if (open)
      void (async () => {
        const { data, error } = await createClient().rpc(
          "field_sales_history",
          { p_workspace: workspace, p_sale: sale },
        );
        if (active) {
          setEvents(data ?? []);
          setError(error?.message ?? "");
        }
      })();
    return () => {
      active = false;
    };
  }, [open, workspace, sale, version]);
  return (
    <div className="mt-2">
      <button
        className="text-sm underline"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        Sale history · Beta
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {error ? (
            <p role="alert">{error}</p>
          ) : !events.length ? (
            <p>Loading history…</p>
          ) : (
            events.map((e) => (
              <p key={e.id} className="text-sm">
                {e.actor} · {e.action} ·{" "}
                {new Date(e.created_at).toLocaleString()}
                <br />
                Version {e.version} · {e.status} ·{" "}
                {money(e.value_minor, e.currency)} · Sale date {e.sold_on}
                {e.reason && (
                  <>
                    <br />
                    {e.reason}
                  </>
                )}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}
// Quote every cell and neutralize spreadsheet formula prefixes in user-authored values.
export function csvCell(value: unknown) {
  let s = value == null ? "" : String(value);
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function salesCSV(d: SalesData) {
  const rows: unknown[][] = [
    [
      "Sale ID",
      "Representative",
      "Status",
      "Sale date",
      "Contract value (minor units)",
      "Currency",
      "Campaign",
      "As of",
      "Period start",
      "Period end",
    ],
  ];
  for (const s of d.sales)
    rows.push([
      s.id,
      s.rep_name,
      s.status,
      s.sold_on,
      s.value_minor ?? "Private",
      s.currency,
      d.options.campaigns.find((c) => c.id === s.campaign_id)?.name ??
        "Unassigned",
      d.as_of,
      d.period_start,
      d.period_end,
    ]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
export function downloadSalesCSV(d: SalesData) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", salesCSV(d)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `wolfgrid-sales-beta-${d.period}-${d.today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
