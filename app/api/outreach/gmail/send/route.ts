import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceMembershipForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { gmailAccess, gmailMime } from '@/lib/outreach/gmail';
import { emailDestination } from '@/lib/outreach/native';
export const runtime = 'nodejs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const input = await request.json().catch(() => null);
  if (!input || ![input.requestId, input.workspaceId, input.contactId].every(value => typeof value === 'string' && UUID.test(value)) || typeof input.body !== 'string' || typeof input.subject !== 'string' || !input.body.trim() || !input.subject.trim() || input.body.length > 20000 || input.subject.length > 200) return NextResponse.json({ error: 'Choose a contact and enter a subject and message (up to 20,000 characters).' }, { status: 400 });
  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(admin as unknown as MinimalSupabaseClient, user.id, input.workspaceId);
  if (membership.workspaceId !== input.workspaceId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data: contact, error: contactError } = await admin.from('contacts').select('id,email,user_id').eq('id', input.contactId).eq('workspace_id', input.workspaceId).maybeSingle();
  if (contactError || !contact) return NextResponse.json({ error: 'Contact unavailable.' }, { status: 404 });
  // Team administrators may contact their team’s leads; members only their own.
  if (contact.user_id !== user.id && membership.role !== 'owner' && membership.role !== 'admin') return NextResponse.json({ error: 'You do not have access to send to this contact.' }, { status: 403 });
  const recipient = emailDestination(contact.email);
  if (!recipient) return NextResponse.json({ error: 'Contact has no valid email.' }, { status: 400 });
  let gmail: Awaited<ReturnType<typeof gmailAccess>>;
  try { gmail = await gmailAccess(user.id); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Reconnect Gmail.' }, { status: 409 }); }
  const hash = createHash('sha256').update(JSON.stringify([input.workspaceId, recipient, gmail.email, input.subject, input.body])).digest('hex');
  const key = { user_id: user.id, request_id: input.requestId, contact_id: contact.id };
  const { error: reserveError } = await admin.from('gmail_outreach_sends').insert({ ...key, workspace_id: input.workspaceId, content_hash: hash, status: 'sending' });
  if (reserveError) {
    if (reserveError.code !== '23505') return NextResponse.json({ error: 'Could not reserve this send. No email was sent.' }, { status: 503 });
    const { data } = await admin.from('gmail_outreach_sends').select('status,content_hash').match(key).single();
    if (data?.content_hash !== hash) return NextResponse.json({ error: 'This send was already started with different content.' }, { status: 409 });
    return NextResponse.json({ status: data.status === 'sending' ? 'unknown' : data.status, duplicate: true });
  }
  let status: 'accepted' | 'failed' | 'unknown' = 'unknown';
  let providerId: string | null = null;
  try {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${gmail.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: gmailMime(gmail.email, recipient, input.subject, input.body) }), signal: AbortSignal.timeout(20_000) });
    if (response.ok) {
      status = 'accepted';
      const data = await response.json().catch(() => ({}));
      providerId = typeof data.id === 'string' ? data.id : null;
    } else { status = response.status >= 500 ? 'unknown' : 'failed'; }
  } catch { /* An interrupted response can still mean Gmail accepted the send. Never retry automatically. */ }
  const { error: logError } = await admin.from('gmail_outreach_sends').update({ status, provider_id: providerId }).match(key);
  if (status === 'accepted') {
    await admin.from('contact_activities').insert({ contact_id: contact.id, type: 'email', note: `Email submitted through Gmail: ${input.subject}`, timestamp: new Date().toISOString() });
  }
  return NextResponse.json({ status, warning: logError ? 'Send result could not be saved. Check Gmail before resending.' : null });
}
