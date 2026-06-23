export function TeamSeatSelector() {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
      <p className="inline-flex rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white">
        50% off early bird pricing
      </p>
      <p className="mt-4 text-3xl font-black text-zinc-900">
        $30 USD
      </p>
      <p className="mt-1 text-sm font-semibold text-zinc-700">
        per user per month, normally <span className="text-zinc-400 line-through">$60 USD</span>
      </p>
      <p className="mt-2 text-sm font-semibold text-zinc-600">
        CA$40 / user / month, normally <span className="text-zinc-400 line-through">CA$80</span>
      </p>
      <p className="mt-3 text-xs font-medium text-emerald-700">
        Founding Team Pricing
      </p>
    </div>
  );
}
