import assert from "node:assert/strict";
import { test } from "node:test";
import {
  avatarUrl,
  initials,
  lastLocationLabel,
  liveState,
  memberColor,
  sessionTotals,
  type TeamLivePresence,
} from "../team-live-map-display";
const now = Date.parse("2026-10-26T16:00:00Z");
const row: TeamLivePresence = {
  user_id: "alex",
  display_name: "Alex Smith",
  color: "#123456",
  campaign_id: "campaign",
  campaign_name: "North",
  session_id: "shared",
  lat: 43.6,
  lng: -79.4,
  status: "active",
  updated_at: new Date(now).toISOString(),
  started_at: new Date(now - 60000).toISOString(),
  active_seconds: 60,
  distance_meters: 100,
  doors_hit: 12,
  conversations: 4,
  flyers_delivered: 10,
};
test("fresh, paused, delayed and expired positions have distinct states", () => {
  assert.equal(liveState(row, now), "Active");
  assert.equal(liveState({ ...row, status: "paused" }, now), "Paused");
  assert.equal(liveState(row, now + 60000), "Active");
  assert.equal(liveState(row, now + 60001), "Location delayed");
  assert.equal(liveState(row, now + 300000), "Location delayed");
  assert.equal(liveState(row, now + 300001), "Offline");
});
test("invalid, absent and inactive GPS never appears active", () => {
  for (const patch of [
    { lat: NaN },
    { lng: Infinity },
    { lat: 91 },
    { lng: -181 },
    { updated_at: "invalid" },
    { updated_at: null },
    { status: "inactive" },
  ]) {
    assert.equal(liveState({ ...row, ...patch }, now), "Offline");
  }
  assert.equal(liveState(undefined, now), "Offline");
});
test("location age remains readable and handles device clock skew", () => {
  assert.equal(lastLocationLabel(row, now + 45000), "Updated 45s ago");
  assert.equal(lastLocationLabel(row, now + 120000), "Updated 2m ago");
  assert.equal(lastLocationLabel(row, now - 5000), "Updated 0s ago");
  assert.equal(lastLocationLabel(undefined, now), "No recent location");
});
test("shared sessions are counted once and individual sessions remain separate", () => {
  assert.deepEqual(
    sessionTotals([
      row,
      { ...row, user_id: "maria" },
      {
        ...row,
        user_id: "tyler",
        session_id: "other",
        doors_hit: 9,
        conversations: 2,
        flyers_delivered: 8,
      },
    ]),
    { doors: 21, conversations: 6, flyers: 18 },
  );
  assert.deepEqual(sessionTotals([]), {
    doors: 0,
    conversations: 0,
    flyers: 0,
  });
});
test("photos and member colours accept safe values and initials have a fallback", () => {
  assert.equal(
    avatarUrl("https://example.com/avatar.png"),
    "https://example.com/avatar.png",
  );
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "bad-url",
    null,
  ])
    assert.equal(avatarUrl(value), null);
  assert.equal(memberColor("red;position:fixed"), "#3B82F6");
  assert.equal(memberColor("#e10019"), "#e10019");
  assert.equal(initials(" Alex Smith "), "AS");
  assert.equal(initials(""), "?");
});
