import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { getFubAuthForUserWorkspace } from '../_lib/auth';
import {
  extractPersonId,
  FUB_API_BASE,
  getCurrentUserId,
  resolvePersonIdByContact,
  withFubPersonRetry,
} from '../_lib/client';
import { FUB_CONNECTION_PROVIDERS } from '../_lib/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type VoiceAIAppointment = {
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  invitee_email: string | null;
};

type VoiceAIFollowUp = {
  at: string | null;
  details: string | null;
  task_title: string | null;
};

type VoiceAIJson = {
  summary: string;
  note: string;
  outcome: string;
  lead_status: 'no_answer' | 'talked' | 'appointment' | 'do_not_knock' | 'hot_lead';
  contact_update: boolean;
  push_to_fub: boolean;
  follow_up_at: string | null;
  follow_up: VoiceAIFollowUp | null;
  next_action: string;
  priority: string;
  appointment: VoiceAIAppointment | null;
  contact: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  };
  tags: string[];
  confidence: number;
};

const OUTCOMES = ['no_answer', 'spoke', 'follow_up', 'not_interested', 'hot_lead', 'appointment_set'];
const LEAD_STATUSES = ['no_answer', 'talked', 'appointment', 'do_not_knock', 'hot_lead'] as const;
const CONFIDENCE_THRESHOLD = 0.65;

const VOICE_LOG_SYSTEM_PROMPT = `You are a field sales assistant. Extract structured data from this door-knocking voice note.
Return ONLY valid JSON with no markdown, no code block, no extra text. Use exactly these keys:
- summary (string): clean 1-3 sentence summary
- note (string): clean note text to save on the lead/contact record
- outcome (exactly one of: no_answer, spoke, follow_up, not_interested, hot_lead, appointment_set)
- lead_status (exactly one of: no_answer, talked, appointment, do_not_knock, hot_lead)
- contact_update (boolean): true if the note contains new or corrected contact information
- push_to_fub (boolean): true only when this should be sent to CRM after user review
- follow_up_at (ISO 8601 datetime string or null; resolve relative times like "next Tuesday at 6" using the provided timezone and current date)
- follow_up (object or null): { at, details, task_title }; use null when there is no concrete follow-up request
- next_action (one of: call, text, email, drop_by, send_cma, none)
- priority (one of: hot, warm, cold)
- appointment (object or null): { title, start_at (ISO8601), end_at (ISO8601), location (string or null), invitee_email (string or null) }; if end missing use start + 30 minutes
- contact (object): { first_name, last_name, email, phone } (all string or null)
- tags (array of strings)
- confidence (number 0.0 to 1.0)

Rules:
- "No answer", "left flyer", "nobody home" -> outcome: no_answer
- "Talked to [name]", "spoke with" -> outcome: spoke or follow_up
- Map lead_status as:
  - no_answer -> no_answer
  - spoke -> talked
  - follow_up or appointment_set -> appointment
  - not_interested -> do_not_knock
  - hot_lead -> hot_lead
- "Follow up next Tuesday at 6" -> set follow_up_at to that datetime in the given timezone
- If follow_up_at is set, also return follow_up.at and include details/task_title when spoken
- If appointment intent is clear (e.g. "booked a showing", "scheduled for Friday 2pm") set appointment object; else null
- Extract any spoken name/phone/email into contact
- contact_update should be true only if the contact object includes actual extracted data
- push_to_fub should be false when confidence is low, no lead/contact signal exists, or the user is clearly just dictating a private note
- Today's date for relative parsing: [CURRENT_DATE]
- If follow_up_at is ambiguous, set null and put the suggestion in summary
- confidence: 0.9+ when clear, < 0.65 when ambiguous (then we will not auto-create task/appointment)`;

function fallbackAiFromTranscript(transcript: string): VoiceAIJson {
  const lower = transcript.toLowerCase();
  const outcome = /no answer|nobody home|not home|left flyer/.test(lower)
    ? 'no_answer'
    : /appointment|scheduled|booked/.test(lower)
      ? 'appointment_set'
      : /hot lead|very interested|ready to buy|ready to sell/.test(lower)
        ? 'hot_lead'
        : /not interested|no thanks/.test(lower)
          ? 'not_interested'
          : 'follow_up';

  const emailMatch = transcript.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = transcript.match(/(\+?1[\s-]?)?(\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}/);
  const hasContactData = Boolean(emailMatch?.[0] || phoneMatch?.[0]);

  return {
    summary: transcript.slice(0, 280),
    note: transcript.slice(0, 280),
    outcome,
    lead_status:
      outcome === 'no_answer'
        ? 'no_answer'
        : outcome === 'not_interested'
          ? 'do_not_knock'
          : outcome === 'hot_lead'
            ? 'hot_lead'
            : 'appointment',
    contact_update: hasContactData,
    push_to_fub: hasContactData || outcome === 'hot_lead' || outcome === 'appointment_set',
    follow_up_at: null,
    follow_up: null,
    next_action: 'none',
    priority: outcome === 'hot_lead' || outcome === 'appointment_set' ? 'hot' : 'warm',
    appointment: null,
    contact: {
      first_name: null,
      last_name: null,
      email: emailMatch?.[0] ?? null,
      phone: phoneMatch?.[0] ?? null,
    },
    tags: ['voice-log'],
    confidence: 0.55,
  };
}

function stripJsonBlock(raw: string): string {
  return raw.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function parseAIJson(content: string): VoiceAIJson | null {
  try {
    const parsed = JSON.parse(stripJsonBlock(content)) as VoiceAIJson;
    if (typeof parsed.summary !== 'string') return null;
    if (typeof parsed.note !== 'string') parsed.note = parsed.summary;
    if (!OUTCOMES.includes(parsed.outcome)) parsed.outcome = 'follow_up';
    if (!LEAD_STATUSES.includes(parsed.lead_status)) {
      parsed.lead_status =
        parsed.outcome === 'no_answer'
          ? 'no_answer'
          : parsed.outcome === 'not_interested'
            ? 'do_not_knock'
            : parsed.outcome === 'hot_lead'
              ? 'hot_lead'
              : 'appointment';
    }
    const hasContactData = Boolean(
      parsed.contact?.first_name ||
      parsed.contact?.last_name ||
      parsed.contact?.email ||
      parsed.contact?.phone
    );
    parsed.contact_update = parsed.contact_update === true || hasContactData;
    parsed.push_to_fub =
      parsed.push_to_fub === true ||
      parsed.lead_status === 'hot_lead' ||
      parsed.lead_status === 'appointment' ||
      hasContactData;
    if (!parsed.follow_up) {
      parsed.follow_up = parsed.follow_up_at
        ? {
            at: parsed.follow_up_at,
            details: parsed.next_action === 'none' ? null : parsed.next_action.replace(/_/g, ' '),
            task_title: parsed.next_action === 'none' ? null : parsed.next_action.replace(/_/g, ' '),
          }
        : null;
    }
    const confidence = Number(parsed.confidence);
    parsed.confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
    if (parsed.confidence < CONFIDENCE_THRESHOLD) {
      parsed.push_to_fub = false;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function analyzeTranscript(transcript: string, timezone: string): Promise<VoiceAIJson> {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) return fallbackAiFromTranscript(transcript);

  const currentDateStr = new Date().toISOString().slice(0, 10);
  const systemPrompt = VOICE_LOG_SYSTEM_PROMPT.replace('[CURRENT_DATE]', currentDateStr);
  const userPrompt = `Timezone: ${timezone}\nTranscript:\n${transcript}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) return fallbackAiFromTranscript(transcript);

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) return fallbackAiFromTranscript(transcript);

  const parsed = parseAIJson(content);
  return parsed ?? fallbackAiFromTranscript(transcript);
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const mode = formData.get('mode')?.toString()?.trim() ?? 'push';
    const parseOnly = mode === 'parse_only';
    const audio = formData.get('audio');
    const campaignId = formData.get('campaign_id')?.toString()?.trim();
    const addressId = formData.get('address_id')?.toString()?.trim();
    const address = formData.get('address')?.toString()?.trim() ?? '';
    const timezone = formData.get('timezone')?.toString()?.trim() || 'America/Toronto';

    if (!campaignId || !addressId) {
      return NextResponse.json({ error: 'Missing campaign_id or address_id' }, { status: 400 });
    }
    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
    }

    const openAiKey = process.env.OPENAI_API_KEY;
    if (!openAiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 500 });
    }

    const supabase = createAdminClient();
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('workspace_id')
      .eq('id', campaignId)
      .maybeSingle();

    if (!campaign?.workspace_id) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      requestUser.id,
      campaign.workspace_id
    );
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 403 }
      );
    }

    const fubAuth = parseOnly
      ? null
      : await getFubAuthForUserWorkspace(
          supabase,
          requestUser.id,
          workspaceResolution.workspaceId
        );
    if (!parseOnly && !fubAuth) {
      return NextResponse.json({ error: 'Follow Up Boss not connected' }, { status: 400 });
    }

    const whisperForm = new FormData();
    whisperForm.append('file', audio, 'voice.m4a');
    whisperForm.append('model', 'whisper-1');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
      },
      body: whisperForm,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      console.error('voice-log transcription error:', whisperRes.status, err);
      return NextResponse.json(
        { error: 'Could not transcribe audio. Please try again.' },
        { status: 422 }
      );
    }

    const whisperJson = (await whisperRes.json()) as { text?: string };
    const transcript = (whisperJson.text ?? '').trim();
    if (!transcript) {
      return NextResponse.json(
        { error: 'No speech detected. Please try again.' },
        { status: 422 }
      );
    }

    const aiJson = await analyzeTranscript(transcript, timezone);
    if (parseOnly) {
      return NextResponse.json({
        transcript,
        ai_json: aiJson,
      });
    }

    const lowConfidence = aiJson.confidence < CONFIDENCE_THRESHOLD || !aiJson.push_to_fub;
    if (!aiJson.push_to_fub) {
      return NextResponse.json({
        transcript,
        ai_json: aiJson,
        fub_results: {
          skippedLowConfidence: true,
        },
      });
    }

    const eventPayload = {
      source: 'FLYR',
      system: 'FLYR',
      type: 'General Inquiry',
      message: aiJson.note || aiJson.summary,
      person: {
        firstName: aiJson.contact.first_name ?? '',
        lastName: aiJson.contact.last_name ?? '',
        ...(aiJson.contact.email ? { emails: [{ value: aiJson.contact.email }] } : {}),
        ...(aiJson.contact.phone ? { phones: [{ value: aiJson.contact.phone }] } : {}),
        ...(
          address
            ? {
                addresses: [{ street: address, country: 'US' }],
              }
            : {}
        ),
      },
      metadata: {
        flyr_voice_log: true,
        campaign_id: campaignId,
        address_id: addressId,
        outcome: aiJson.outcome,
        confidence: aiJson.confidence,
      },
    };

    const fubResponse = await fetch(`${FUB_API_BASE}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...fubAuth!.headers,
      },
      body: JSON.stringify(eventPayload),
    });

    if (!fubResponse.ok) {
      const text = await fubResponse.text();
      return NextResponse.json(
        {
          error: `Failed to push to Follow Up Boss (${fubResponse.status})`,
          transcript,
          ai_json: aiJson,
          fub_results: { errors: [text.slice(0, 400)] },
        },
        { status: 502 }
      );
    }

    let eventId: string | undefined;
    let personId: number | undefined;
    let noteId: number | undefined;
    let taskId: number | undefined;
    let appointmentId: number | undefined;

    const eventResponseText = await fubResponse.text();
    if (eventResponseText.trim()) {
      try {
        const parsed = JSON.parse(eventResponseText) as Record<string, unknown>;
        eventId = parsed.id != null ? String(parsed.id) : undefined;
        personId = extractPersonId(parsed);
      } catch {
        console.warn('[followupboss/voice-log] Failed to parse /events response JSON');
      }
    }

    if (personId == null && eventId) {
      const eventFetchRes = await fetch(`${FUB_API_BASE}/events/${encodeURIComponent(eventId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...fubAuth!.headers,
        },
      });
      if (eventFetchRes.ok) {
        try {
          const eventDetails = await eventFetchRes.json();
          personId = extractPersonId(eventDetails);
        } catch {
          // ignore event decode errors
        }
      }
    }

    if (personId == null) {
      personId = await resolvePersonIdByContact(fubAuth!.headers, {
        email: aiJson.contact.email,
        phone: aiJson.contact.phone,
      });
    }

    if (personId == null) {
      return NextResponse.json(
        {
          error: 'Lead event created but personId could not be resolved.',
          transcript,
          ai_json: aiJson,
          fub_results: {
            errors: ['Lead event created but personId could not be resolved.'],
          },
        },
        { status: 502 }
      );
    }

    const currentUserId = await getCurrentUserId(fubAuth!.headers).catch(() => undefined);
    const normalizedNote = aiJson.note?.trim() || aiJson.summary;
    const noteBody = [normalizedNote]
      .concat(transcript ? [`\n\nTranscript: ${transcript.slice(0, 2000)}`] : [])
      .join('');

    try {
      const noteData = await withFubPersonRetry(async () => {
        const noteRes = await fetch(`${FUB_API_BASE}/notes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...fubAuth!.headers,
          },
          body: JSON.stringify({
            personId,
            subject: 'Voice log',
            body: noteBody,
          }),
        });
        if (!noteRes.ok) {
          const noteErr = await noteRes.text();
          throw new Error(noteErr || `Note creation failed (${noteRes.status})`);
        }
        return (await noteRes.json()) as { id?: number };
      });
      if (noteData?.id != null) {
        noteId = Number(noteData.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          error: 'Failed to push to Follow Up Boss. You can retry or save locally.',
          transcript,
          ai_json: aiJson,
          fub_results: {
            personId,
            errors: [message],
          },
        },
        { status: 502 }
      );
    }

    if (!lowConfidence && aiJson.follow_up_at) {
      const taskTitle =
        aiJson.follow_up?.task_title?.trim() ||
        `Follow up: ${aiJson.summary.slice(0, 80)}`;
      try {
        const taskData = await withFubPersonRetry(async () => {
          const taskRes = await fetch(`${FUB_API_BASE}/tasks`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...fubAuth!.headers,
            },
            body: JSON.stringify({
              personId,
              name: taskTitle,
              type: 'Follow Up',
              dueDate: aiJson.follow_up_at.slice(0, 10),
              dueDateTime: aiJson.follow_up_at,
              ...(currentUserId != null ? { assignedUserId: currentUserId } : {}),
            }),
          });
          if (!taskRes.ok) {
            const taskErr = await taskRes.text();
            throw new Error(taskErr || `Task creation failed (${taskRes.status})`);
          }
          return (await taskRes.json()) as { id?: number };
        });
        if (taskData?.id != null) {
          taskId = Number(taskData.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
          {
            error: 'Failed to push to Follow Up Boss. You can retry or save locally.',
            transcript,
            ai_json: aiJson,
            fub_results: {
              personId,
              noteId,
              errors: [message],
            },
          },
          { status: 502 }
        );
      }
    }

    if (!lowConfidence && aiJson.appointment?.start_at && aiJson.appointment?.end_at) {
      const appointmentDescriptionParts = [
        normalizedNote,
        aiJson.appointment.invitee_email
          ? `Requested external invitee email: ${aiJson.appointment.invitee_email}`
          : null,
      ].filter((value): value is string => Boolean(value));

      try {
        const appointmentData = await withFubPersonRetry(async () => {
          const appointmentRes = await fetch(`${FUB_API_BASE}/appointments`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...fubAuth!.headers,
            },
            body: JSON.stringify({
              title: aiJson.appointment?.title || 'Appointment',
              start: aiJson.appointment.start_at,
              end: aiJson.appointment.end_at,
              ...(aiJson.appointment.location ? { location: aiJson.appointment.location } : {}),
              ...(appointmentDescriptionParts.length
                ? { description: appointmentDescriptionParts.join('\n\n') }
                : {}),
              invitees: [
                { personId },
                ...(currentUserId != null ? [{ userId: currentUserId }] : []),
              ],
            }),
          });
          if (!appointmentRes.ok) {
            const appointmentErr = await appointmentRes.text();
            throw new Error(appointmentErr || `Appointment creation failed (${appointmentRes.status})`);
          }
          return (await appointmentRes.json()) as { id?: number };
        });

        if (appointmentData?.id != null) {
          appointmentId = Number(appointmentData.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
          {
            error: 'Failed to push to Follow Up Boss. You can retry or save locally.',
            transcript,
            ai_json: aiJson,
            fub_results: {
              personId,
              noteId,
              taskId,
              errors: [message],
            },
          },
          { status: 502 }
        );
      }
    }

    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('workspace_id', workspaceResolution.workspaceId)
      .in('provider', [...FUB_CONNECTION_PROVIDERS]);

    const fullName = [aiJson.contact.first_name, aiJson.contact.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    await supabase.from('contacts').insert({
      user_id: requestUser.id,
      workspace_id: workspaceResolution.workspaceId,
      campaign_id: campaignId,
      full_name: fullName || 'Voice Lead',
      email: aiJson.contact.email,
      phone: aiJson.contact.phone,
      address: address || '',
      status: 'new',
      notes: transcript,
    });

    return NextResponse.json({
      transcript,
      ai_json: aiJson,
      fub_results: {
        personId,
        noteId,
        taskId,
        appointmentId,
        ...(lowConfidence && (aiJson.follow_up_at || aiJson.appointment)
          ? { skippedLowConfidence: true }
          : {}),
        errors: [],
      },
    });
  } catch (error) {
    console.error('voice-log route error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Voice log failed' },
      { status: 500 }
    );
  }
}
