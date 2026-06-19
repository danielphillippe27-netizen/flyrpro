export function TeamSeatSelector() {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
        50% off early bird pricing
      </p>
      <div className="mt-3 text-sm font-semibold text-zinc-600">
        <span className="mr-2 text-zinc-400 line-through">$60 USD</span>
        <span className="mr-2 text-zinc-400 line-through">$80 CAD</span>
      </div>
      <p className="mt-1 text-2xl font-black text-zinc-900">
        $30 USD / $40 CAD
      </p>
      <p className="mt-1 text-sm font-semibold text-zinc-700">
        per user per month
      </p>
      <p className="mt-3 text-xs font-medium text-emerald-700">
        Founding Team Pricing
      </p>
    </div>
  );
}
