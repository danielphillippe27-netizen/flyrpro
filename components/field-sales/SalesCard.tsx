"use client";
import Link from "next/link";
import { useFieldSales, money } from "@/lib/field-sales/client";
export function SalesCard() {
  const scope = useFieldSales({}, true);
  if (!scope.data?.enabled) return null;
  return (
    <SalesCardContent key={`${scope.workspaceId}:${scope.data.user_id}`} />
  );
}
function SalesCardContent() {
  const { data: d, error, refresh } = useFieldSales();
  if (error)
    return (
      <button className="text-sm text-muted-foreground" onClick={refresh}>
        Sales unavailable · Retry
      </button>
    );
  if (!d?.enabled) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <Link
        href="/sales"
        className="flex justify-between font-semibold text-lg"
      >
        Sales · Beta <span aria-hidden>→</span>
      </Link>
      {d.needs_setup ? (
        <p>An owner must select the reporting currency and timezone.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <strong className="text-2xl">{d.totals.weekly_sales}</strong>
              <p>
                This week · {money(d.totals.weekly_revenue_minor, d.currency)}
              </p>
            </div>
            <div>
              <strong className="text-2xl">{d.totals.monthly_sales}</strong>
              <p>
                This month · {money(d.totals.monthly_revenue_minor, d.currency)}
              </p>
            </div>
          </div>
          <p>
            {d.goal.target
              ? `${d.goal.completed} / ${d.goal.target} monthly sales · ${d.goal.remaining} remaining`
              : "No monthly sales target set"}
          </p>
          {d.goal.target && (
            <progress
              className="w-full"
              max={d.goal.target}
              value={Math.min(d.goal.completed, d.goal.target)}
            />
          )}
          <p className="text-sm">Wolfy: {d.coaching}</p>
          {d.feed[0] && (
            <p className="text-sm text-muted-foreground">
              Latest team win: {d.feed[0].rep_name} · {d.feed[0].sold_on}
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function RecordSaleLink({ contactId }: { contactId: string }) {
  const { data } = useFieldSales({}, true);
  return data?.enabled ? (
    <Link
      className="inline-flex rounded-lg border px-4 py-2 text-sm font-medium"
      href={`/sales?lead=${encodeURIComponent(contactId)}`}
    >
      Record Sale · Beta
    </Link>
  ) : null;
}
