import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { captureEventSchema } from '@/lib/field-recordings/contracts';
import { ownedRecording, recordingError } from '@/lib/field-recordings/access';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid recording ID' }, { status: 400 });
    const input = z.object({ events: z.array(captureEventSchema).min(1).max(100) }).strict().safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'Invalid capture events' }, { status: 400 });
    const { user, db, recording } = await ownedRecording(request, id);
    let current = recording;
    // A batch may commit a prefix. Return the last accepted sequence for safe replay.
    for (const event of [...input.data.events].sort((a, b) => a.sequence - b.sequence)) {
      if (event.deviceSerial && event.deviceSerial !== recording.device_serial) return NextResponse.json({ error: 'Device mismatch', lastAcceptedSequence: current.last_event_sequence }, { status: 409 });
      const { data, error } = await db.rpc('append_field_recording_event', { p_recording: id, p_user: user.id, p_event: event });
      if (error) return NextResponse.json({ error: 'Event sequence or identity conflict; reconcile before retrying', lastAcceptedSequence: current.last_event_sequence }, { status: 409 });
      current = data;
    }
    return NextResponse.json({ recording: current });
  } catch (error) { return recordingError(error); }
}
