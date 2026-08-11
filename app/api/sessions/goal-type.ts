const databaseGoalTypes = new Set([
  'flyers',
  'knocks',
  'conversations',
  'appointments',
  'time',
  'leads',
]);

export function normalizeSessionGoalType(value: string | null | undefined, mode?: string): string {
  const normalized = value?.trim().toLowerCase().replaceAll('-', '_');
  if (normalized && databaseGoalTypes.has(normalized)) return normalized;
  if (normalized === 'doors' || normalized === 'door' || normalized === 'homes' || normalized === 'knock') {
    return 'knocks';
  }
  return mode === 'flyer' ? 'flyers' : 'knocks';
}
