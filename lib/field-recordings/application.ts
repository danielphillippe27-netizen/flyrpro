/** datetime-local inputs use the user's displayed browser timezone. Reject rolled-over dates. */
export function localActionDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a date and time');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || actionDateInput(date.toISOString()) !== value) throw new Error('Choose a valid date and time in your timezone');
  return date.toISOString();
}
export function actionDateInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
