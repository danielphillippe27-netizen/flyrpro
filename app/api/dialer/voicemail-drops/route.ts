import { NextRequest, NextResponse } from 'next/server';
import type { DialerVoicemailDrop } from '@/types/database';
import { getDialerRequestContext, type DialerRequestContext } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'dialer-voicemail-drops';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
]);

type VoicemailPatchPayload = {
  workspaceId?: string;
  id?: string;
  isActive?: boolean;
};

type VoicemailDeletePayload = {
  workspaceId?: string;
  id?: string;
};

function extensionForAudio(file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension && ['mp3', 'wav', 'm4a', 'mp4'].includes(extension)) return extension;
  if (file.type === 'audio/wav' || file.type === 'audio/x-wav') return 'wav';
  if (file.type === 'audio/mp4' || file.type === 'audio/m4a' || file.type === 'audio/x-m4a') return 'm4a';
  if (file.type === 'audio/aac') return 'aac';
  return 'mp3';
}

function cleanFileName(fileName: string): string {
  return fileName
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'voicemail-drop';
}

async function setActiveDrop(
  admin: DialerRequestContext['admin'],
  workspaceId: string,
  id: string
) {
  const now = new Date().toISOString();
  const inactiveResult = await admin
    .from('dialer_voicemail_drops')
    .update({ is_active: false, updated_at: now })
    .eq('workspace_id', workspaceId);

  if (inactiveResult.error) return { data: null, error: inactiveResult.error };

  return admin
    .from('dialer_voicemail_drops')
    .update({ is_active: true, updated_at: now })
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .select('*')
    .single();
}

export async function GET(request: NextRequest) {
  const context = await getDialerRequestContext(request, request.nextUrl.searchParams.get('workspaceId'));
  if (context instanceof NextResponse) return context;

  const { data, error } = await context.admin
    .from('dialer_voicemail_drops')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[dialer/voicemail-drops] failed to load recordings', error);
    return NextResponse.json({ error: 'Failed to load voicemail recordings.' }, { status: 500 });
  }

  return NextResponse.json({ recordings: (data ?? []) as DialerVoicemailDrop[] });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Upload must use multipart/form-data.' }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: 'Invalid upload form data.' }, { status: 400 });

  const workspaceId = String(formData.get('workspaceId') ?? '').trim() || null;
  const context = await getDialerRequestContext(request, workspaceId);
  if (context instanceof NextResponse) return context;

  const file = formData.get('file');
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ error: 'Choose an audio file to upload.' }, { status: 400 });
  }

  if (!ALLOWED_AUDIO_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Use an MP3, WAV, or M4A audio file.' }, { status: 400 });
  }

  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio file must be 10MB or smaller.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const extension = extensionForAudio(file);
  const safeName = cleanFileName(file.name);
  const storagePath = `${context.workspaceId}/${context.requestUser.id}/${Date.now()}-${safeName}.${extension}`;
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await context.admin.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    console.error('[dialer/voicemail-drops] failed to upload audio', uploadError);
    return NextResponse.json({ error: uploadError.message || 'Failed to upload voicemail audio.' }, { status: 500 });
  }

  const { data: publicUrlData } = context.admin.storage.from(BUCKET).getPublicUrl(storagePath);

  await context.admin
    .from('dialer_voicemail_drops')
    .update({ is_active: false, updated_at: now })
    .eq('workspace_id', context.workspaceId);

  const { data, error } = await context.admin
    .from('dialer_voicemail_drops')
    .insert({
      workspace_id: context.workspaceId,
      user_id: context.requestUser.id,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      public_url: publicUrlData.publicUrl,
      filename: file.name,
      content_type: file.type,
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[dialer/voicemail-drops] failed to save recording metadata', error);
    await context.admin.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: 'Failed to save voicemail recording.' }, { status: 500 });
  }

  return NextResponse.json({ recording: data as DialerVoicemailDrop });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as VoicemailPatchPayload;
  if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const context = await getDialerRequestContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  if (body.isActive !== true) {
    return NextResponse.json({ error: 'Only activating a voicemail recording is supported.' }, { status: 400 });
  }

  const { data, error } = await setActiveDrop(context.admin, context.workspaceId, body.id);
  if (error || !data) {
    console.error('[dialer/voicemail-drops] failed to activate recording', error);
    return NextResponse.json({ error: 'Failed to activate voicemail recording.' }, { status: 500 });
  }

  return NextResponse.json({ recording: data as DialerVoicemailDrop });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as VoicemailDeletePayload;
  if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const context = await getDialerRequestContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  const { data: existing, error: loadError } = await context.admin
    .from('dialer_voicemail_drops')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('id', body.id)
    .maybeSingle();

  if (loadError) {
    console.error('[dialer/voicemail-drops] failed to load recording for delete', loadError);
    return NextResponse.json({ error: 'Failed to load voicemail recording.' }, { status: 500 });
  }

  if (!existing) return NextResponse.json({ error: 'Voicemail recording not found.' }, { status: 404 });

  const recording = existing as DialerVoicemailDrop;
  const { error: deleteError } = await context.admin
    .from('dialer_voicemail_drops')
    .delete()
    .eq('workspace_id', context.workspaceId)
    .eq('id', recording.id);

  if (deleteError) {
    console.error('[dialer/voicemail-drops] failed to delete recording metadata', deleteError);
    return NextResponse.json({ error: 'Failed to delete voicemail recording.' }, { status: 500 });
  }

  await context.admin.storage.from(BUCKET).remove([recording.storage_path]);
  return NextResponse.json({ deletedId: recording.id });
}
