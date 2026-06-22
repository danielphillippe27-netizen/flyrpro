import type { DialerCall, DialerCallRecordingSummary } from '@/types/database';

export type DialerCallRecording = {
  recordingSid: string;
  recordingUrl: string;
  mp3Url: string;
  provider: string | null;
  status: string;
  durationSeconds: number | null;
  channels: number | null;
  updatedAt: string | null;
  errorCode: string | null;
};

export function getDialerCallRecording(call: Pick<DialerCall, 'status_payload' | 'telecom_provider'>): DialerCallRecording | null {
  const recording = call.status_payload?.recording;
  if (!recording || typeof recording !== 'object') {
    return null;
  }

  const candidate = recording as Record<string, unknown>;
  const recordingSid = typeof candidate.recordingSid === 'string' ? candidate.recordingSid : null;
  const recordingUrl = typeof candidate.recordingUrl === 'string' ? candidate.recordingUrl : null;
  const mp3Url = typeof candidate.mp3Url === 'string' ? candidate.mp3Url : null;

  if (!recordingSid || !recordingUrl || !mp3Url) {
    return null;
  }

  return {
    recordingSid,
    recordingUrl,
    mp3Url,
    provider: typeof candidate.provider === 'string' ? candidate.provider : call.telecom_provider ?? null,
    status: typeof candidate.status === 'string' ? candidate.status : 'pending',
    durationSeconds:
      typeof candidate.durationSeconds === 'number'
        ? candidate.durationSeconds
        : typeof candidate.durationSeconds === 'string'
          ? Number(candidate.durationSeconds) || null
          : null,
    channels:
      typeof candidate.channels === 'number'
        ? candidate.channels
        : typeof candidate.channels === 'string'
          ? Number(candidate.channels) || null
          : null,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
    errorCode: typeof candidate.errorCode === 'string' ? candidate.errorCode : null,
  };
}

export function getDialerCallRecordingSummary(
  call: Pick<DialerCall, 'status_payload' | 'telecom_provider'>
): DialerCallRecordingSummary | null {
  const recording = call.status_payload?.recording;
  if (!recording || typeof recording !== 'object') {
    return null;
  }

  const candidate = recording as Record<string, unknown>;
  const status = typeof candidate.status === 'string' ? candidate.status : 'pending';
  const mp3Url = typeof candidate.mp3Url === 'string' ? candidate.mp3Url : null;
  const recordingSid = typeof candidate.recordingSid === 'string' ? candidate.recordingSid : null;
  const errorCode = typeof candidate.errorCode === 'string' ? candidate.errorCode : null;
  const durationSeconds =
    typeof candidate.durationSeconds === 'number'
      ? candidate.durationSeconds
      : typeof candidate.durationSeconds === 'string'
        ? Number(candidate.durationSeconds) || null
        : null;
  const channels =
    typeof candidate.channels === 'number'
      ? candidate.channels
      : typeof candidate.channels === 'string'
        ? Number(candidate.channels) || null
        : null;

  return {
    status,
    available: Boolean(recordingSid && mp3Url && status === 'completed'),
    duration_seconds: durationSeconds,
    channels,
    updated_at: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
    error_code: errorCode,
  };
}
