import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type VoiceAIJson = {
  summary: string;
  outcome: string;
  follow_up_at: string | null;
  next_action: string;
  priority: string;
  appointment: null;
  contact: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  };
  tags: string[];
  confidence: number;
};

function decryptApiKey(encryptedData: string): string {
  const keyString = process.env.ENCRYPTION_KEY || 'flyr-default-encryption-key-32chars!';
  const key = Buffer.from(keyString.slice(0, 32));
  const parts = encryptedData.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted data format');
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

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

  return {
    summary: transcript.slice(0, 280),
    outcome,
    follow_up_at: null,
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

async function analyzeTranscript(transcript: string, timezone: string): Promise<VoiceAIJson> {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) return fallbackAiFromTranscript(transcript);

  const prompt = `Extract structured JSON from this door-knocking voice note.
Return exactly this schema and valid JSON only:
{
  "summary": "string",
  "outcome": "no_answer|spoke|follow_up|not_interested|hot_lead|appointment_set",
  "follow_up_at": "ISO datetime or null",
  "next_action": "call|text|email|drop_by|send_cma|none",
  "priority": "hot|warm|cold",
  "appointment": null,
  "contact": {"first_name": null|string, "last_name": null|string, "email": null|string, "phone": null|string},
  "tags": ["string"],
  "confidence": 0.0
}
Timezone: ${timezone}
Transcript: ${transcript}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You return strict JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) return fallbackAiFromTranscript(transcript);

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) return fallbackAiFromTranscript(transcript);

  try {
    const parsed = JSON.parse(content) as Partial<VoiceAIJson>;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : transcript.slice(0, 280),
      outcome: typeof parsed.outcome === 'string' ? parsed.outcome : 'follow_up',
      follow_up_at: typeof parsed.follow_up_at === 'string' ? parsed.follow_up_at : null,
      next_action: typeof parsed.next_action === 'string' ? parsed.next_action : 'none',
      priority: typeof parsed.priority === 'string' ? parsed.priority : 'warm',
      appointment: null,
      contact: {
        first_name:
          typeof parsed.contact?.first_name === 'string' ? parsed.contact.first_name : null,
        last_name: typeof parsed.contact?.last_name === 'string' ? parsed.contact.last_name : null,
        email: typeof parsed.contact?.email === 'string' ? parsed.contact.email : null,
        phone: typeof parsed.contact?.phone === 'string' ? parsed.contact.phone : null,
      },
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((v) => typeof v === 'string') : [],
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.55,
    };
  } catch {
    return fallbackAiFromTranscript(transcript);
  }
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
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

    const { data: connection } = await supabase
      .from('crm_connections')
      .select('api_key_encrypted')
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'followupboss')
      .maybeSingle();

    if (!connection?.api_key_encrypted) {
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
    const apiKey = decryptApiKey(connection.api_key_encrypted);

    const eventPayload = {
      source: 'FLYR',
      system: 'FLYR',
      type: 'General Inquiry',
      message: `${aiJson.summary}${address ? ` | Address: ${address}` : ''}`,
      person: {
        firstName: aiJson.contact.first_name ?? '',
        lastName: aiJson.contact.last_name ?? '',
        ...(aiJson.contact.email ? { emails: [{ value: aiJson.contact.email }] } : {}),
        ...(aiJson.contact.phone ? { phones: [{ value: aiJson.contact.phone }] } : {}),
      },
      metadata: {
        flyr_voice_log: true,
        campaign_id: campaignId,
        address_id: addressId,
        outcome: aiJson.outcome,
        confidence: aiJson.confidence,
      },
    };

    const fubResponse = await fetch('https://api.followupboss.com/v1/events', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
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

    const fubJson = (await fubResponse.json()) as { id?: number; personId?: number };
    const personId = typeof fubJson.personId === 'number' ? fubJson.personId : undefined;
    const eventId = typeof fubJson.id === 'number' ? fubJson.id : undefined;

    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'followupboss');

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
        noteId: eventId,
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
