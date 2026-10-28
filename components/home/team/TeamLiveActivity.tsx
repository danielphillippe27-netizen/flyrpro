"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import mapboxgl from "mapbox-gl";
import { Crosshair, LocateFixed, Radio, RefreshCw, Users } from "lucide-react";
import {
  avatarUrl,
  initials,
  lastLocationLabel,
  liveState,
  memberColor,
  sessionTotals,
  type LiveState,
  type TeamLivePresence,
  type TeamMapMember,
} from "@/lib/team-live-map-display";

type Props = {
  map: mapboxgl.Map | null;
  members: TeamMapMember[];
  presence: TeamLivePresence[];
  loading: boolean;
  error: string | null;
  lastSyncAt: number | null;
  demo?: boolean;
  onRefresh: () => void;
};
type MarkerEntry = {
  id: string;
  element: HTMLDivElement;
  marker: mapboxgl.Marker;
};
const STATES: LiveState[] = ["Active", "Paused", "Location delayed", "Offline"];

function PersonAvatar({
  member,
  large = false,
}: {
  member: TeamMapMember;
  large?: boolean;
}) {
  const url = avatarUrl(member.avatar_url);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-slate-900 font-bold text-white ${large ? "h-11 w-11 text-sm" : "h-10 w-10 text-xs"}`}
      style={{ borderColor: memberColor(member.color) }}
    >
      {initials(member.display_name)}
      {url && failedUrl !== url && (
        // Profile URLs can come from multiple storage providers; preserve the initials on failure.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      )}
    </span>
  );
}

function Status({ state }: { state: LiveState }) {
  const color =
    state === "Active"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : state === "Paused" || state === "Location delayed"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${color}`}
    >
      {state}
    </span>
  );
}

export function TeamLiveActivity({
  map,
  members,
  presence,
  loading,
  error,
  lastSyncAt,
  demo = false,
  onRefresh,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<LiveState | "All">("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const registry = useRef(new Map<string, MarkerEntry>());
  const [entries, setEntries] = useState<MarkerEntry[]>([]);
  const initiallyFitted = useRef(false);
  const rows = useMemo(
    () => presence.filter((row) => liveState(row, now) !== "Offline"),
    [presence, now],
  );
  const presenceById = useMemo(
    () => new Map(rows.map((row) => [row.user_id, row])),
    [rows],
  );
  const roster = useMemo(() => {
    const all = new Map(members.map((member) => [member.user_id, member]));
    rows.forEach((row) => all.set(row.user_id, row));
    return [...all.values()];
  }, [members, rows]);
  const selected = selectedId ? presenceById.get(selectedId) : undefined;
  const selectedState = liveState(selected, now);
  const canFollow = selectedState === "Active" || selectedState === "Paused";
  const totals = sessionTotals(rows);
  const sharedSessionIds = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      if (row.session_id)
        counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
    });
    return new Set(
      [...counts].filter(([, count]) => count > 1).map(([id]) => id),
    );
  }, [rows]);
  const sharedSession =
    !!selected?.session_id && sharedSessionIds.has(selected.session_id);

  const viewportState = useRef({ rows, following, canFollow, selected });
  useEffect(() => {
    viewportState.current = { rows, following, canFollow, selected };
  }, [rows, following, canFollow, selected]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    initiallyFitted.current = false;
    const markers = registry.current;
    if (!map) return;
    const stopFollowing = () => setFollowing(false);
    const resize = new ResizeObserver(() => {
      map.resize();
      const view = viewportState.current;
      if (view.following && view.canFollow && view.selected) {
        map.jumpTo({ center: [view.selected.lng, view.selected.lat] });
      } else if (view.rows.length && !demo) {
        const bounds = new mapboxgl.LngLatBounds();
        view.rows.forEach((row) => bounds.extend([row.lng, row.lat]));
        map.fitBounds(bounds, { padding: 100, maxZoom: 16, duration: 0 });
      }
    });
    resize.observe(map.getContainer());
    map.on("dragstart", stopFollowing);
    return () => {
      resize.disconnect();
      map.off("dragstart", stopFollowing);
      markers.forEach((entry) => entry.marker.remove());
      markers.clear();
    };
  }, [map, demo]);

  useEffect(() => {
    if (!map) {
      setEntries([]);
      return;
    }
    const markers = registry.current;
    const ids = new Set(rows.map((row) => row.user_id));
    markers.forEach((entry, id) => {
      if (!ids.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    });
    for (const row of rows) {
      let entry = markers.get(row.user_id);
      if (!entry) {
        const element = document.createElement("div");
        entry = {
          id: row.user_id,
          element,
          marker: new mapboxgl.Marker({ element, anchor: "bottom" })
            .setLngLat([row.lng, row.lat])
            .addTo(map),
        };
        markers.set(row.user_id, entry);
      }
      entry.marker.setLngLat([row.lng, row.lat]);
      entry.element.style.zIndex = row.user_id === selectedId ? "3" : "1";
    }
    setEntries([...markers.values()]);
    if (!initiallyFitted.current && rows.length && !demo) {
      const bounds = new mapboxgl.LngLatBounds();
      rows.forEach((row) => bounds.extend([row.lng, row.lat]));
      map.fitBounds(bounds, { padding: 100, maxZoom: 16, duration: 0 });
      initiallyFitted.current = true;
    }
  }, [map, rows, selectedId, demo]);

  useEffect(() => {
    if (map && following && canFollow && selected) {
      map.easeTo({
        center: [selected.lng, selected.lat],
        duration: demo ? 120 : 800,
      });
    }
    // Follow coordinates, rather than re-centering for every clock tick or stats update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, following, canFollow, selected?.lat, selected?.lng, demo]);

  function selectPerson(row: TeamLivePresence) {
    setSelectedId(row.user_id);
    const state = liveState(row, now);
    setFollowing(state === "Active" || state === "Paused");
    map?.flyTo({
      center: [row.lng, row.lat],
      zoom: Math.max(map.getZoom(), 16),
      duration: 700,
    });
  }
  function fitEveryone() {
    setFollowing(false);
    if (!map || !rows.length) return;
    const bounds = new mapboxgl.LngLatBounds();
    rows.forEach((row) => bounds.extend([row.lng, row.lat]));
    map.fitBounds(bounds, { padding: 100, maxZoom: 16, duration: 600 });
  }

  return (
    <aside
      aria-label="Live team activity"
      className="flex w-full shrink-0 flex-col border-border bg-card lg:h-[680px] lg:w-[330px] lg:border-r"
    >
      <div className="border-b border-border p-5">
        <div className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-red-600 dark:text-red-400">
            <Radio className="h-3 w-3" />
            {demo ? "DEMO" : "LIVE"}
          </span>
          <button
            type="button"
            aria-label="Refresh team locations"
            disabled={loading || demo}
            onClick={onRefresh}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Team Activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your people. Their progress. Live.
        </p>
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {demo
            ? "Simulated locations and activity"
            : error
              ? lastSyncAt
                ? "Connection interrupted · retrying"
                : "Team activity unavailable"
              : lastSyncAt
                ? "Refreshes every 15 seconds"
                : "Connecting to your team…"}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ["Reporting", rows.length],
            ["Doors", totals.doors],
            ["Convos", totals.conversations],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-border bg-muted/30 p-2.5"
            >
              <p className="text-xl font-bold tabular-nums">{value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Reporting-session totals · shared sessions counted once
        </p>
        <button
          type="button"
          onClick={fitEveryone}
          disabled={!map || !rows.length}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-40"
        >
          <Users className="h-4 w-4" />
          Show everyone
        </button>
      </div>
      <div
        className="flex flex-wrap gap-1 border-b border-border px-4 py-3"
        aria-label="Filter team activity"
      >
        {(["All", ...STATES] as const).map((state) => (
          <button
            key={state}
            type="button"
            aria-pressed={filter === state}
            onClick={() => setFilter(state)}
            className={`rounded-md px-2 py-1.5 text-[11px] font-semibold ${filter === state ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
          >
            {state === "Location delayed" ? "Delayed" : state}{" "}
            <span className="opacity-65">
              {state === "All"
                ? roster.length
                : roster.filter(
                    (member) =>
                      liveState(presenceById.get(member.user_id), now) ===
                      state,
                  ).length}
            </span>
          </button>
        ))}
      </div>
      <div className="max-h-[320px] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
        {roster
          .filter(
            (member) =>
              filter === "All" ||
              liveState(presenceById.get(member.user_id), now) === filter,
          )
          .map((member) => {
            const row = presenceById.get(member.user_id);
            const state = liveState(row, now);
            const isSelected = selectedId === member.user_id;
            return (
              <button
                key={member.user_id}
                type="button"
                aria-label={`View ${member.display_name}`}
                aria-pressed={isSelected}
                onClick={() =>
                  row
                    ? selectPerson(row)
                    : (setSelectedId(member.user_id), setFollowing(false))
                }
                className={`flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left hover:bg-muted/60 ${isSelected ? "bg-muted" : ""}`}
              >
                <PersonAvatar member={member} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {member.display_name}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {row
                      ? `${row.doors_hit} doors · ${row.conversations} convos`
                      : "No active location sharing"}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {lastLocationLabel(row, now)}
                    {row?.session_id && sharedSessionIds.has(row.session_id)
                      ? " · shared session"
                      : ""}
                  </span>
                </span>
                <Status state={state} />
              </button>
            );
          })}
        {!roster.length && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {loading
              ? "Loading your team…"
              : error
                ? "Team activity unavailable. Try refreshing."
                : "No team members to display."}
          </div>
        )}
        {!!roster.length &&
          !roster.some(
            (member) =>
              filter === "All" ||
              liveState(presenceById.get(member.user_id), now) === filter,
          ) && (
            <p className="p-5 text-sm text-muted-foreground">
              No teammates in this group.
            </p>
          )}
      </div>
      {selected && (
        <div
          className="border-t border-border bg-muted/20 p-4"
          aria-label="Selected teammate details"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-bold">
              {selected.display_name}
            </p>
            <Status state={selectedState} />
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {selected.campaign_name}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <span>{selected.doors_hit} doors</span>
            <span>{selected.conversations} conversations</span>
            <span>{selected.flyers_delivered} flyers</span>
            <span>{(selected.distance_meters / 1000).toFixed(2)} km</span>
            <span>{Math.floor(selected.active_seconds / 60)} active min</span>
          </div>
          {sharedSession && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Shared session · these stats belong to the session.
            </p>
          )}
          <button
            type="button"
            disabled={!canFollow || !map}
            onClick={() => setFollowing(!following)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:opacity-40"
          >
            <LocateFixed className="h-4 w-4" />
            {following && canFollow
              ? "Stop following"
              : canFollow
                ? "Follow location"
                : "Waiting for fresh location"}
          </button>
          {selectedState === "Location delayed" && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
              Last reported position. Waiting for a fresh GPS update.
            </p>
          )}
        </div>
      )}
      {selectedId && !selected && (
        <p className="border-t border-border p-4 text-xs text-muted-foreground">
          No recent location for this teammate. Following is unavailable.
        </p>
      )}
      <div className="border-t border-border px-4 py-3 text-[10px] text-muted-foreground">
        <Crosshair className="mr-1 inline h-3 w-3" />
        Locations appear during active sessions with location access.
      </div>
      {entries.map((entry) => {
        const row = presenceById.get(entry.id);
        if (!row) return null;
        const state = liveState(row, now);
        return createPortal(
          <button
            type="button"
            aria-label={`Locate ${row.display_name}, ${row.doors_hit} doors, ${state}`}
            aria-pressed={selectedId === row.user_id}
            onClick={() => selectPerson(row)}
            className={`relative flex items-center gap-2 rounded-full border bg-slate-950/95 py-1.5 pl-1.5 ${selectedId === row.user_id ? "pr-4" : "pr-1.5 sm:pr-4"} text-left text-white shadow-xl backdrop-blur focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${state === "Location delayed" ? "border-amber-400 border-dashed" : selectedId === row.user_id ? "border-white" : "border-white/25"}`}
          >
            <span
              aria-hidden="true"
              className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white"
              style={{
                backgroundColor:
                  state === "Location delayed"
                    ? "#F59E0B"
                    : memberColor(row.color),
              }}
            />
            <PersonAvatar member={row} large />
            <span
              className={`max-w-[145px] ${selectedId === row.user_id ? "block" : "hidden sm:block"}`}
            >
              <span className="block truncate text-xs font-bold">
                {row.display_name}
              </span>
              <span className="mt-0.5 block text-[10px] text-slate-300">
                {row.doors_hit} doors · {row.conversations} convos
              </span>
              <span
                className={`block text-[9px] ${state === "Active" ? "text-emerald-400" : "text-amber-300"}`}
              >
                {state}
                {row.session_id && sharedSessionIds.has(row.session_id)
                  ? " · shared session"
                  : ""}
              </span>
            </span>
          </button>,
          entry.element,
          entry.id,
        );
      })}
    </aside>
  );
}
