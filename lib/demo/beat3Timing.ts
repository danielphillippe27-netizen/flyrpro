export const BEAT3_POLYGON_DRAW_DURATION_MS = 1100;
export const BEAT3_BUILDING_CASCADE_DURATION_MS = 2600;
export const BEAT3_TOTAL_REVEAL_DURATION_MS = BEAT3_POLYGON_DRAW_DURATION_MS + BEAT3_BUILDING_CASCADE_DURATION_MS;

export function formatBeat3FinalTimer(durationMs = BEAT3_TOTAL_REVEAL_DURATION_MS) {
  return `${(durationMs / 1000).toFixed(1)} s real provisioning time · unit splits included`;
}

export function formatBeat3ElapsedTimer(elapsedMs: number, durationMs = BEAT3_TOTAL_REVEAL_DURATION_MS) {
  const clampedMs = Math.max(0, Math.min(elapsedMs, durationMs));
  return `${(clampedMs / 1000).toFixed(1).padStart(4, '0')} s · unit splits included`;
}
