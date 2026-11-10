export const SESSION_METRICS = [
  { id: 'doors', label: 'Doors' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'leads', label: 'Leads' },
  { id: 'appointments', label: 'Appointments' },
] as const;

export type SessionMetric = (typeof SESSION_METRICS)[number]['id'];

export function getSessionCounts(payload: Record<string, unknown>) {
  return {
    doors: payload.doors_hit ?? payload.doors_knocked,
    conversations: payload.conversations,
    leads: payload.leads_created ?? payload.leads,
    appointments: payload.appointments_count ?? payload.appointments,
  };
}

export function parseSessionRoute(raw: unknown): GeoJSON.LineString | null {
  let geometry: unknown = raw;
  if (typeof raw === 'string') {
    try {
      geometry = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!geometry || typeof geometry !== 'object' || !('type' in geometry) ||
      geometry.type !== 'LineString' || !('coordinates' in geometry)) return null;

  const { coordinates } = geometry;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  if (!coordinates.every((point) =>
    Array.isArray(point) && point.length >= 2 &&
    Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
    Number.isFinite(point[1]) && Math.abs(point[1]) <= 90
  )) return null;
  const [first] = coordinates;
  if (!coordinates.some(([lng, lat]) => lng !== first[0] || lat !== first[1])) return null;
  return geometry as GeoJSON.LineString;
}
