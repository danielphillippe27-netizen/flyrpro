"use client";

import type { EnrichedFarmTouch } from '@/lib/farms/analytics';
import { farmSessionTotals, type FarmActivitySession } from '@/lib/farms/session-totals';

const day = 86400000;
const dateTime = (value: string) => Date.parse(value.length === 10 ? `${value}T00:00:00` : value);
const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function FarmActivityPace({ sessions, touches, totalHomes, startDate, endDate }: {
  sessions: FarmActivitySession[];
  touches: EnrichedFarmTouch[];
  totalHomes: number;
  startDate: string;
  endDate: string;
}) {
  const now = Date.now();
  const total = farmSessionTotals(sessions, touches)?.doors ?? 0;
  const start = dateTime(startDate);
  const end = dateTime(endDate);
  const hasPlan = Number.isFinite(start) && Number.isFinite(end) && end > start && totalHomes > 0;
  const rows = [...new Map(sessions.filter(session => session.session_mode == null || ['door_knocking', 'doorknock'].includes(session.session_mode)).map(session => [session.id, session])).values()];
  const dated = rows.filter(session => session.start_time && Number.isFinite(Date.parse(session.start_time)) && Date.parse(session.start_time) <= now)
    .sort((a, b) => Date.parse(a.start_time!) - Date.parse(b.start_time!));
  const amount = (session: FarmActivitySession) => Number.isFinite(session.doors_hit) ? Math.max(0, session.doors_hit ?? 0) : 0;
  const undated = total - dated.reduce((sum, session) => sum + amount(session), 0);
  const min = Math.min(hasPlan ? start : now - day, ...dated.map(session => Date.parse(session.start_time!)));
  const max = Math.max(now, hasPlan ? end : now, min + day);
  const ceiling = Math.max(totalHomes, total, 1);
  const x = (time: number) => 70 + (time - min) / (max - min) * 850;
  const y = (value: number) => 230 - value / ceiling * 190;
  let cumulative = 0;
  const points = [`${x(min)},${y(0)}`, ...dated.map(session => {
    cumulative += amount(session);
    return `${x(Date.parse(session.start_time!))},${y(cumulative)}`;
  }), `${x(now)},${y(cumulative)}`].join(' ');
  const expected = hasPlan ? totalHomes * Math.min(1, Math.max(0, (now - start) / (end - start))) : 0;
  const remainingDays = hasPlan ? Math.max(0, Math.ceil((end - Math.max(now, start)) / day)) : 0;
  const remaining = Math.max(0, totalHomes - total);
  const label = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return <section className="rounded-2xl border border-border bg-card p-5" aria-label="Door activity and target pace">
    <h2 className="text-xl font-semibold">Door knocks over time</h2>
    <p className="mt-3 text-3xl font-semibold tabular-nums">{count(total)} / {count(totalHomes)} <span className="text-sm font-normal text-muted-foreground">door knocks · {totalHomes ? count(total / totalHomes * 100) : 0}% of one farm pass</span></p>
    <p className="mt-2 text-sm text-muted-foreground">Recorded activity includes repeat visits.</p>
    {hasPlan ? <p className="mt-2 text-sm">Target: {count(totalHomes)} knocks by {label(end)} · {count(Math.round(expected))} planned by today{remainingDays > 0 ? ` · ${count(Math.ceil(remaining / remainingDays))} per day needed` : remaining > 0 ? ' · Target date reached' : ' · Target reached'}</p> : <p className="mt-2 text-sm text-muted-foreground">Set valid farm start and end dates to show your target pace.</p>}
    <div className="mt-4 flex gap-5 text-sm"><span className="text-red-600">● Recorded knocks</span><span className="text-muted-foreground">┄ Target pace</span></div>
    <svg viewBox="0 0 1000 280" className="mt-2 w-full" role="img" aria-label={`${count(total)} door knocks. ${hasPlan ? `Target pace: ${count(Math.round(expected))} by today, ${count(totalHomes)} by ${label(end)}.` : 'No target dates set.'}`}>
      {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}><line x1="70" x2="920" y1={y(ceiling * fraction)} y2={y(ceiling * fraction)} stroke="currentColor" className="text-border" /><text x="60" y={y(ceiling * fraction) + 4} textAnchor="end" fill="currentColor" className="text-muted-foreground" fontSize="12">{count(Math.round(ceiling * fraction))}</text></g>)}
      {hasPlan && <line x1={x(start)} y1={y(0)} x2={x(end)} y2={y(totalHomes)} stroke="currentColor" className="text-muted-foreground" strokeWidth="2" strokeDasharray="7 5" />}
      <line x1={x(now)} x2={x(now)} y1="35" y2="230" stroke="currentColor" className="text-border" strokeDasharray="3 4" />
      <polyline points={points} fill="none" stroke="#E33449" strokeWidth="3" />
      <circle cx={x(now)} cy={y(total)} r="5" fill="#E33449" />
      <text x={x(now)} y={y(total) - 12} textAnchor="middle" fill="#E33449" fontSize="14" fontWeight="600">{count(total)} to date</text>
      <text x="70" y="265" fill="currentColor" className="text-muted-foreground" fontSize="12">{label(min)}</text>
      <text x="920" y="265" textAnchor="end" fill="currentColor" className="text-muted-foreground" fontSize="12">{label(max)}</text>
    </svg>
    {undated > 0 && <p className="text-xs text-muted-foreground">{count(undated)} knocks have no usable session date. They are included in today’s total, but not assigned a date on the history line.</p>}
  </section>;
}
