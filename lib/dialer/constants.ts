import type { DialerCallDisposition, DialerCallStatus, DialerSessionLeadStatus, DialerSessionStatus } from '@/types/database';

export const DIALER_SESSION_STATUSES: DialerSessionStatus[] = ['draft', 'active', 'paused', 'completed'];
export const DIALER_SESSION_LEAD_STATUSES: DialerSessionLeadStatus[] = [
  'pending',
  'claimed',
  'calling',
  'completed',
  'skipped',
  'invalid',
];
export const DIALER_CALL_STATUSES: DialerCallStatus[] = [
  'pending',
  'initiated',
  'ringing',
  'in-progress',
  'answered',
  'completed',
  'busy',
  'failed',
  'no-answer',
  'canceled',
];
export const DIALER_CALL_DISPOSITIONS: DialerCallDisposition[] = [
  'connected',
  'no_answer',
  'left_voicemail',
  'callback_requested',
  'follow_up',
  'appointment_set',
  'do_not_call',
  'bad_number',
  'not_interested',
];

export const DIALER_DISPOSITION_LABELS: Record<DialerCallDisposition, string> = {
  connected: 'Connected',
  no_answer: 'No answer',
  left_voicemail: 'Left voicemail',
  callback_requested: 'Callback requested',
  follow_up: 'Follow up',
  appointment_set: 'Appointment set',
  do_not_call: 'Do not call',
  bad_number: 'Bad number',
  not_interested: 'Not interested',
};

export function isFinalCallStatus(status: DialerCallStatus | string | null | undefined): boolean {
  return ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status ?? '');
}

export function formatDialerCallStatus(status: DialerCallStatus | string | null | undefined): string {
  switch (status) {
    case 'in-progress':
      return 'In progress';
    case 'no-answer':
      return 'No answer';
    default:
      return (status ?? 'pending')
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
