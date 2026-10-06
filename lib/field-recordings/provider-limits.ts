import { z } from 'zod';
export type PaidStage = 'transcribe' | 'analyze' | 'write';
const names: Record<PaidStage, string> = {
  transcribe: 'FIELD_RECORDING_DAILY_TRANSCRIPTION_REQUESTS',
  analyze: 'FIELD_RECORDING_DAILY_JEV_REQUESTS',
  write: 'FIELD_RECORDING_DAILY_WRITING_REQUESTS',
};
export function providerRequestLimit(stage: PaidStage, environment: Record<string, string | undefined> = process.env): number | null {
  const value = environment[names[stage]];
  if (value === undefined) return null;
  if (!/^(0|[1-9]\d*)$/.test(value) || Number(value) > 1000000) throw new Error('Invalid provider limit configuration');
  return Number(value);
}
export function nextProviderLimitDelay(now = new Date()): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}
export function providerLimitStatus(environment: Record<string, string | undefined> = process.env) {
  const configured = Object.values(names).some(name => environment[name] !== undefined);
  try {
    return { configured, valid: true, transcribe: providerRequestLimit('transcribe', environment), analyze: providerRequestLimit('analyze', environment), write: providerRequestLimit('write', environment) };
  } catch { return { configured, valid: false, transcribe: null, analyze: null, write: null }; }
}
export class ProviderLimitWait extends Error {
  constructor(readonly code: 'daily_provider_limit' | 'provider_limit_unavailable', readonly delay: number) { super(code); }
}
export function transcriptionMinuteLimit(environment: Record<string, string | undefined> = process.env): number | null {
  const value = environment.FIELD_RECORDING_DAILY_TRANSCRIPTION_MINUTES;
  if (value === undefined) return null;
  if (!/^(0|[1-9]\d*)$/.test(value) || Number(value) > 1000000) throw new Error('Invalid audio limit configuration');
  return Number(value);
}
export function audioLimitStatus(environment: Record<string, string | undefined> = process.env) {
  const configured = environment.FIELD_RECORDING_DAILY_TRANSCRIPTION_MINUTES !== undefined;
  try { return { configured, valid: true, minutesPerDay: transcriptionMinuteLimit(environment) }; }
  catch { return { configured, valid: false, minutesPerDay: null }; }
}
const audioUsageSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), resetAt: z.string(),
  reservedMinutes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export function checkedAudioUsage(input: unknown) {
  const usage = audioUsageSchema.parse(input);
  checkedProviderUsage({ day: usage.day, resetAt: usage.resetAt, transcribe: 0, analyze: 0, write: 0 });
  return usage;
}
export function checkedAudioBudget(input: unknown) {
  const value = z.object({
    configured: z.boolean(), valid: z.boolean(), minutesPerDay: z.number().int().min(0).max(1000000).nullable(),
    usage: audioUsageSchema.nullable(),
  }).strict().parse(input);
  if ((!value.configured || !value.valid) && value.minutesPerDay !== null) throw new Error('Invalid audio budget status');
  if (value.configured && value.valid && value.minutesPerDay === null) throw new Error('Missing audio budget');
  if (value.usage) checkedAudioUsage(value.usage);
  return value;
}
export function audioBudgetSummary(value: ReturnType<typeof checkedAudioBudget>) {
  const limit = !value.valid ? 'The audio-minute limit is invalid; new transcriptions are paused.'
    : !value.configured ? 'Daily transcription minutes are not limited.'
    : `Daily transcription limit per workspace: ${value.minutesPerDay} minutes.`;
  const usage = value.usage ? ` Reserved on ${value.usage.day} UTC: ${value.usage.reservedMinutes} minutes${value.valid && value.minutesPerDay !== null ? ` (${Math.max(0, value.minutesPerDay - value.usage.reservedMinutes)} remaining)` : ''}.`
    : ' Audio-minute usage is unavailable.';
  return `${limit}${usage} Each file rounds up to a whole minute. Includes failed or uncertain submissions; older unmeasured submissions reserve 300 minutes each. Resets at midnight UTC. This controls reservations, not provider billing.`;
}
const usageSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), resetAt: z.string(),
  transcribe: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  analyze: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  write: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export function checkedProviderUsage(input: unknown) {
  const usage = usageSchema.parse(input);
  const start = Date.parse(`${usage.day}T00:00:00Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== usage.day || Date.parse(usage.resetAt) !== start + 86400000) throw new Error('Invalid provider usage period');
  return usage;
}
export function providerUsageSummary(usage: ReturnType<typeof checkedProviderUsage>, limits: ReturnType<typeof providerLimitStatus>) {
  const names: Record<PaidStage, string> = { transcribe: 'PLAUD', analyze: 'Jev', write: 'writing' };
  const stages: PaidStage[] = ['transcribe', 'analyze', 'write'];
  const counts = stages.map(stage => `${names[stage]} ${usage[stage]}${limits.valid && limits[stage] !== null ? ` (${Math.max(0, limits[stage]! - usage[stage])} remaining)` : ''}`).join(', ');
  const exhausted = limits.valid ? stages.filter(stage => limits[stage] !== null && usage[stage] >= limits[stage]!) : [];
  return `Reserved on ${usage.day} UTC: ${counts}. Includes failed or uncertain requests.${exhausted.length ? ` Daily limit reached for ${exhausted.map(stage => names[stage]).join(', ')}; affected requests can retry after midnight UTC.` : ''}`;
}
