import { NextRequest, NextResponse } from 'next/server';
import { retentionEnabled } from '@/lib/field-recordings/retention';
import { recordingAccess, recordingError } from '@/lib/field-recordings/access';
import { fieldPinDeletionEnabled, fieldProcessingEnabled } from '@/lib/field-recordings/rollout';
import { audioLimitStatus, checkedAudioUsage, checkedProviderUsage, providerLimitStatus } from '@/lib/field-recordings/provider-limits';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const { db, user, workspaceId } = await recordingAccess(request, request.nextUrl.searchParams.get('workspaceId') || undefined);
    const { data: usage, error: usageError } = await db.rpc('field_recording_provider_usage', { p_workspace: workspaceId, p_user: user.id });
    let dailyRequestUsage = null;
    if (!usageError) { try { dailyRequestUsage = checkedProviderUsage(usage); } catch { /* Missing/invalid usage never implies an available quota. */ } }
    const { data: audioUsage, error: audioError } = await db.rpc('field_recording_audio_usage', { p_workspace: workspaceId, p_user: user.id });
    let checkedAudio = null;
    if (!audioError) { try { checkedAudio = checkedAudioUsage(audioUsage); } catch { /* Invalid usage never implies a remaining budget. */ } }
    return NextResponse.json({
      deviceAccessConfigured: Boolean(process.env.PLAUD_CLIENT_ID && process.env.PLAUD_SECRET_KEY),
      transcriptionConfigured: Boolean(process.env.PLAUD_CLIENT_ID && process.env.PLAUD_API_KEY),
      jevConfigured: Boolean(process.env.TYPESAFE_API_KEY),
      writingConfigured: Boolean(process.env.OPENAI_API_KEY),
      processingDispatchConfigured: Boolean(process.env.CRON_SECRET),
      processingEnabled: fieldProcessingEnabled(),
      retentionEnabled: retentionEnabled(process.env.FIELD_RECORDING_RETENTION_ENABLED, process.env.FIELD_RECORDING_DELETION_ENABLED),
      pinDeletionEnabled: fieldPinDeletionEnabled(),
      dailyRequestLimits: providerLimitStatus(),
      dailyRequestUsage,
      dailyAudioBudget: { ...audioLimitStatus(), usage: checkedAudio },
      audioTimelineConfigured: ['continuous', 'pause_compacted'].includes(process.env.PLAUD_AUDIO_TIMELINE_MODE || ''),
      capturePlatform: 'native',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
