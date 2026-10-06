import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ownedRecording, recordingError } from '@/lib/field-recordings/access';

export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; chunkId: string }> }) {
  try {
    const { id, chunkId } = await context.params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(chunkId).success) return NextResponse.json({ error: 'Invalid recording chunk' }, { status: 400 });
    const { db } = await ownedRecording(request, id);
    const { data: chunk, error } = await db.from('field_recording_chunks').select('storage_path,verified_at').eq('id', chunkId).eq('recording_id', id).maybeSingle();
    if (error) throw error;
    if (!chunk?.verified_at) return NextResponse.json({ error: 'Verified audio is not available yet' }, { status: 404 });
    const { data, error: storageError } = await db.storage.from('field-recordings').createSignedUrl(chunk.storage_path, 300);
    if (storageError || !data?.signedUrl) throw storageError || new Error('Audio unavailable');
    return NextResponse.json({ url: data.signedUrl, expiresAt: new Date(Date.now() + 300000).toISOString() }, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) { return recordingError(error); }
}
