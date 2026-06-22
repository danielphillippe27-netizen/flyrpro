import { NextRequest, NextResponse } from 'next/server';
import type { DialerCall, DiallerLead } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { getDialerCallRecording } from '@/lib/dialer/recordings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RecordingLeadGroup = {
  leadId: string;
  leadName: string;
  company: string | null;
  phone: string | null;
  isStarred: boolean;
  recordings: Array<{
    callId: string;
    createdAt: string;
    answeredAt: string | null;
    endedAt: string | null;
    durationSeconds: number | null;
    provider: string | null;
    recordingStatus: string;
    recordingUpdatedAt: string | null;
    downloadUrl: string;
  }>;
};

function getPayloadString(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getLeadId(call: DialerCall): string | null {
  return getPayloadString(call.status_payload, 'diallerLeadId');
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const starredOnly = request.nextUrl.searchParams.get('starred') === 'true';
  const context = await getDialerRequestContext(request, workspaceId);
  if (context instanceof NextResponse) return context;

  const { data: calls, error } = await context.admin
    .from('dialer_calls')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    console.error('[dialer/recordings] failed to load calls', error);
    return NextResponse.json({ error: 'Failed to load call recordings.' }, { status: 500 });
  }

  const recordedCalls = ((calls ?? []) as DialerCall[])
    .map((call) => ({ call, recording: getDialerCallRecording(call) }))
    .filter(({ recording }) => recording?.status === 'completed' && Boolean(recording.mp3Url));

  const leadIds = Array.from(
    new Set(recordedCalls.map(({ call }) => getLeadId(call)).filter((id): id is string => Boolean(id)))
  );
  const leadsById = new Map<string, DiallerLead>();
  if (leadIds.length > 0) {
    const { data: leads, error: leadsError } = await context.admin
      .from('dialler_leads')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.requestUser.id)
      .in('id', leadIds);

    if (leadsError) {
      console.warn('[dialer/recordings] failed to load lead stars', leadsError);
    } else {
      for (const lead of (leads ?? []) as DiallerLead[]) {
        leadsById.set(lead.id, lead);
      }
    }
  }

  const groupsByLeadId = new Map<string, RecordingLeadGroup>();
  for (const { call, recording } of recordedCalls) {
    if (!recording) continue;
    const leadId = getLeadId(call) ?? `call:${call.id}`;
    const lead = leadsById.get(leadId) ?? null;
    const isStarred = lead?.is_starred === true;
    if (starredOnly && !isStarred) continue;

    const group =
      groupsByLeadId.get(leadId) ??
      {
        leadId,
        leadName: lead?.name || getPayloadString(call.status_payload, 'diallerLeadName') || 'Lead',
        company: lead?.company ?? getPayloadString(call.status_payload, 'diallerLeadCompany'),
        phone: lead?.phone ?? getPayloadString(call.status_payload, 'diallerLeadPhone') ?? call.to_number_e164 ?? call.to_number_raw ?? null,
        isStarred,
        recordings: [],
      };

    group.recordings.push({
      callId: call.id,
      createdAt: call.created_at,
      answeredAt: call.answered_at ?? null,
      endedAt: call.ended_at ?? null,
      durationSeconds: recording.durationSeconds ?? call.duration_seconds ?? null,
      provider: call.telecom_provider ?? recording.provider,
      recordingStatus: recording.status,
      recordingUpdatedAt: recording.updatedAt,
      downloadUrl: `/api/dialer/calls/${encodeURIComponent(call.id)}/recording?workspaceId=${encodeURIComponent(context.workspaceId)}`,
    });
    groupsByLeadId.set(leadId, group);
  }

  const groups = Array.from(groupsByLeadId.values())
    .map((group) => ({
      ...group,
      recordings: group.recordings.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    }))
    .sort((a, b) => {
      if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
      return (
        new Date(b.recordings[0]?.createdAt ?? 0).getTime() -
        new Date(a.recordings[0]?.createdAt ?? 0).getTime()
      );
    });

  return NextResponse.json({
    groups,
    totalRecordings: groups.reduce((total, group) => total + group.recordings.length, 0),
    starredRecordings: groups
      .filter((group) => group.isStarred)
      .reduce((total, group) => total + group.recordings.length, 0),
  });
}
