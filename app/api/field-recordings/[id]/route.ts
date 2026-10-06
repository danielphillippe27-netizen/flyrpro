import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import { labelConversationTargets, type CampaignTargetAddress } from '@/lib/field-recordings/targets';
import { campaignTiming } from '@/lib/field-recordings/analytics';
import { captureEventSchema } from '@/lib/field-recordings/contracts';
import { ownedRecording, recordingError } from '@/lib/field-recordings/access';

export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid recording ID' }, { status: 400 });
    const { db, recording } = await ownedRecording(request, id);
    const [conversations, history, chunks, events, session] = await Promise.all([
      db.from('field_conversations').select('*').eq('recording_id', id).neq('review_state', 'superseded').order('created_at'),
      fetchAllInPages(async (from, to) => await db.from('field_conversations').select('*').eq('recording_id', id).eq('review_state', 'superseded').order('created_at').order('id').range(from, to)),
      db.from('field_recording_chunks').select('id,provider_recording_id,session_offset_ms,duration_ms,transcription_state').eq('recording_id', id).order('session_offset_ms'),
      db.from('field_recording_events').select('payload').eq('recording_id', id).order('sequence'),
      db.from('sessions').select('target_building_ids,campaign_id').eq('id', recording.session_id).eq('workspace_id', recording.workspace_id).maybeSingle(),
    ]);
    if (conversations.error || chunks.error || events.error || session.error) throw conversations.error || chunks.error || events.error || session.error;
    const captureEvents = (events.data || []).map(row => captureEventSchema.parse(row.payload));
    const timing = campaignTiming(captureEvents, recording.started_at);
    const targetIds: string[] = (session.data?.target_building_ids || []).filter((target: string) => z.uuid().safeParse(target).success).map((target: string) => target.toLowerCase());
    const markedTargets = captureEvents.filter(event => event.kind === 'door_started' && event.targetId).map(event => event.targetId!.toLowerCase());
    const candidates = [...new Set([...targetIds, ...markedTargets])];
    const addresses: CampaignTargetAddress[] = [];
    if (session.data?.campaign_id && candidates.length) {
      const { data: campaign, error } = await db.from('campaigns').select('id').eq('id', session.data.campaign_id).eq('workspace_id', recording.workspace_id).maybeSingle();
      if (error) throw error;
      if (campaign) {
        for (let start = 0; start < candidates.length; start += 100) {
          const batch = candidates.slice(start, start + 100).join(',');
          addresses.push(...await fetchAllInPages<CampaignTargetAddress>(async (from, to) => await db.from('campaign_addresses')
            .select('id,gers_id,address').eq('campaign_id', campaign.id).or(`id.in.(${batch}),gers_id.in.(${batch})`).order('id').range(from, to)));
        }
      }
    }
    const allowedTargets = candidates.filter(id => targetIds.includes(id) || addresses.some(row => row.id.toLowerCase() === id));
    const targets = labelConversationTargets(allowedTargets, addresses);
    return NextResponse.json({ targets, recording, conversations: conversations.data, history, chunks: chunks.data, timing }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
