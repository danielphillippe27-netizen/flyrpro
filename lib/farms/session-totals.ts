import type { EnrichedFarmTouch } from './analytics';

export type FarmActivitySession = {
  id: string;
  farm_touch_id: string | null;
  session_mode: string | null;
  doors_hit: number | null;
  conversations: number | null;
};

/** Session counters measure attempts, never distinct homes or geographic coverage. */
export function farmSessionTotals(
  sessions: FarmActivitySession[],
  touches: Pick<EnrichedFarmTouch, 'id' | 'resolvedCycleNumber'>[],
  cycle?: number,
) {
  const touchIds = new Set(touches.filter(t => cycle == null || t.resolvedCycleNumber === cycle).map(t => t.id));
  const scoped = new Map(sessions.filter(s =>
    (s.session_mode == null || s.session_mode === 'door_knocking' || s.session_mode === 'doorknock') &&
    (cycle == null || (s.farm_touch_id != null && touchIds.has(s.farm_touch_id)))
  ).map(s => [s.id, s]));
  if (!scoped.size) return null;
  const count = (value: number | null) => Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
  let doors = 0;
  let conversations = 0;
  for (const session of scoped.values()) {
    doors += count(session.doors_hit);
    conversations += count(session.conversations);
  }
  return { doors, conversations, answerRate: doors ? conversations / doors : 0 };
}
