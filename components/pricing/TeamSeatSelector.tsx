export function TeamSeatSelector() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
      <p className="inline-flex rounded-full bg-red-600 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
        50% off early bird pricing
      </p>
      <p className="mt-4 text-4xl font-black tracking-tight text-white">
        $30 USD
      </p>
      <p className="mt-1 text-sm font-semibold text-zinc-300">
        per user / month <span className="ml-1 text-zinc-600 line-through">$60 USD</span>
      </p>
      <p className="mt-2 text-xs font-medium text-zinc-500">
        CA$40 / user / month <span className="line-through">CA$80</span>
      </p>
    </div>
  );
}
