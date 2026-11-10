"use client";

import { Flame, Snowflake } from "lucide-react";

export type CommunicationTotals = {
  window_start: string;
  as_of: string;
  attempts: number;
  outgoing_calls: number;
  answered_calls: number;
  average_gap_seconds: number | null;
  last_message_at: string | null;
  counted_apple_calls: string[];
};

type LocalCall = { startedAt: string; direction: string; connected: boolean; providerId: string | null };

function gapLabel(seconds: number | null) {
  if (seconds == null) return "—";
  if (seconds < 60) return "<1 min";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hr`;
  return `${Math.round(seconds / 86_400)} d`;
}

export function CommunicationStats({ totals, calls }: { totals?: CommunicationTotals; calls: readonly LocalCall[] }) {
  const counted = new Set(totals?.counted_apple_calls);
  const end = Date.parse(totals?.as_of ?? "");
  const start = Date.parse(totals?.window_start ?? "");
  const local = calls.filter(call => {
    const date = Date.parse(call.startedAt);
    return call.direction === "outgoing" && date >= start && date <= end && (!call.providerId || !counted.has(call.providerId));
  });
  const outgoing = (totals?.outgoing_calls ?? 0) + local.length;
  const answered = (totals?.answered_calls ?? 0) + local.filter(call => call.connected).length;
  const last = totals?.last_message_at;
  const hot = last ? end - Date.parse(last) <= 7 * 86_400_000 : false;
  const date = last ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(last)) : null;
  return <dl className="contact-comms-stats" aria-label="Communication stats, last 30 days">
    <div title="Recorded outgoing texts, emails and calls in the last 30 days">
      <dt>Contact attempts <small>30d</small></dt>
      <dd>{totals ? totals.attempts + local.length : "—"}</dd>
    </div>
    <div title="Connected outgoing calls divided by outgoing calls with a recorded outcome in the last 30 days. Connections can include voicemail.">
      <dt>Call answer rate</dt>
      <dd>{outgoing ? <><span>{Math.round(answered / outgoing * 100)}%</span> <small>{answered}/{outgoing}</small></> : "—"}</dd>
    </div>
    <div title="Average time between consecutive recorded texts, incoming and outgoing, in the last 30 days">
      <dt>Avg. text gap</dt>
      <dd>{gapLabel(totals?.average_gap_seconds ?? null)}</dd>
    </div>
    <div title="Based only on the most recent recorded text. Hot means within 7 days.">
      <dt>Last text</dt>
      <dd>{last ? <><span className="contact-recency" data-hot={hot}>{hot ? <Flame size={13} aria-hidden /> : <Snowflake size={13} aria-hidden />}{hot ? "Hot" : "Cold"}</span> <time dateTime={last}>{date}</time></> : <small>{totals ? "No texts yet" : "—"}</small>}</dd>
    </div>
  </dl>;
}
