export type TeamMapMember = {
  user_id: string;
  display_name: string;
  color: string;
  avatar_url?: string | null;
};

export type TeamLivePresence = TeamMapMember & {
  campaign_id: string;
  campaign_name: string;
  session_id: string | null;
  lat: number;
  lng: number;
  status: string;
  updated_at: string | null;
  started_at: string | null;
  active_seconds: number;
  distance_meters: number;
  doors_hit: number;
  conversations: number;
  flyers_delivered: number;
};

export type LiveState = "Active" | "Paused" | "Location delayed" | "Offline";
export function liveState(
  row: TeamLivePresence | undefined,
  now: number,
): LiveState {
  if (
    !row ||
    !Number.isFinite(row.lat) ||
    !Number.isFinite(row.lng) ||
    Math.abs(row.lat) > 90 ||
    Math.abs(row.lng) > 180
  )
    return "Offline";
  const age = now - Date.parse(row.updated_at ?? "");
  if (!Number.isFinite(age) || age > 300_000 || row.status === "inactive")
    return "Offline";
  if (age > 60_000) return "Location delayed";
  return row.status === "paused" ? "Paused" : "Active";
}

export function lastLocationLabel(
  row: TeamLivePresence | undefined,
  now: number,
): string {
  const updated = Date.parse(row?.updated_at ?? "");
  if (!Number.isFinite(updated)) return "No recent location";
  const seconds = Math.max(0, Math.floor((now - updated) / 1000));
  return seconds < 60
    ? `Updated ${seconds}s ago`
    : `Updated ${Math.floor(seconds / 60)}m ago`;
}

export function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

export function avatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function memberColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#3B82F6";
}

export function sessionTotals(rows: TeamLivePresence[]) {
  const seen = new Set<string>();
  const totals = { doors: 0, conversations: 0, flyers: 0 };
  for (const row of rows) {
    const key = row.session_id ?? row.user_id;
    if (seen.has(key)) continue;
    seen.add(key);
    totals.doors += Math.max(0, Number(row.doors_hit) || 0);
    totals.conversations += Math.max(0, Number(row.conversations) || 0);
    totals.flyers += Math.max(0, Number(row.flyers_delivered) || 0);
  }
  return totals;
}
