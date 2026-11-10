import { NextRequest, NextResponse } from 'next/server';
import { sendApnsNotification } from '@/lib/notifications/apns';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type PushJob = {
  id: string;
  workspace_id: string;
  appointment_id: string;
  recipient_id: string;
  kind: 'assignment' | 'reschedule' | 'upcoming';
  delivered_tokens: string[];
  attempt: number;
};

const titles: Record<PushJob['kind'], string> = {
  assignment: 'Appointment assigned to you',
  reschedule: 'Appointment rescheduled',
  upcoming: 'Appointment coming up',
};

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('field_appointment_claim_push');
  if (error) return NextResponse.json({ error: 'Unable to claim appointment reminders' }, { status: 500 });
  const jobs = (data ?? []) as PushJob[];
  const outcomes = await Promise.allSettled(jobs.map(async job => {
    const delivered = new Set(job.delivered_tokens);
    let failure: string | null = null;
    try {
      const tokens = await admin.from('user_push_tokens').select('id, token, environment')
        .eq('user_id', job.recipient_id).eq('platform', 'ios').eq('enabled', true);
      if (tokens.error) throw tokens.error;
      const current = await admin.rpc('field_appointment_push_current', { p_id: job.id, p_attempt: job.attempt });
      if (current.error) throw current.error;
      if (!current.data) return;
      const sends = await Promise.allSettled((tokens.data ?? []).filter(token => !delivered.has(token.id)).map(async token => {
        const environment = token.environment === 'sandbox' ? 'sandbox' : 'production';
        try {
          await sendApnsNotification({
            token: token.token,
            environment,
            payload: {
              aps: { alert: { title: titles[job.kind], body: 'Open WolfGrid to see the appointment.' },
                sound: 'default', 'thread-id': 'appointments' },
              type: 'field_appointment', notification_id: job.id,
              appointment_id: job.appointment_id, user_id: job.recipient_id, workspace_id: job.workspace_id,
            },
          });
          delivered.add(token.id);
        } catch (error) {
          if (error instanceof Error && /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(error.message)) {
            const result = await admin.from('user_push_tokens').update({ enabled: false })
              .eq('id', token.id).eq('user_id', job.recipient_id);
            if (!result.error) return;
          }
          throw error;
        }
      }));
      if (sends.some(result => result.status === 'rejected')) failure = 'One or more iOS reminders could not be delivered';
    } catch {
      failure = 'Reminder delivery could not be checked';
    }
    const result = await admin.rpc('field_appointment_finish_push', {
      p_id: job.id, p_attempt: job.attempt, p_delivered: [...delivered], p_error: failure,
    });
    if (result.error || failure) throw new Error('Reminder delivery needs retry');
  }));
  return NextResponse.json({
    processed: jobs.length,
    retrying: outcomes.filter(outcome => outcome.status === 'rejected').length,
  });
}
