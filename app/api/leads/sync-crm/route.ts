import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

/** Split "First Last" into { firstName, lastName } */
function splitFullName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  if (!fullName || !fullName.trim()) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

type ContactRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  campaign_id: string | null;
  notes: string | null;
};

/**
 * POST /api/leads/sync-crm
 * Syncs the current user's leads/contacts to connected CRMs (Follow Up Boss).
 */
export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let workspaceId: string | null = null;
    try {
      const body = await request.json();
      workspaceId = body?.workspaceId ?? null;
    } catch {
      // no-op: body may be empty
    }

    const workspaceResolution = await resolveWorkspaceIdForUser(supabase as any, user.id, workspaceId);
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }
    const targetWorkspaceId = workspaceResolution.workspaceId;

    const { data: connections } = await supabase
      .from('crm_connections')
      .select('provider, api_key_encrypted')
      .eq('workspace_id', targetWorkspaceId)
      .eq('status', 'connected');

    if (!connections || connections.length === 0) {
      return NextResponse.json(
        { error: 'No CRM connected. Connect Follow Up Boss in Settings → Integrations first.' },
        { status: 400 }
      );
    }

    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, full_name, phone, email, address, campaign_id, notes')
      .eq('workspace_id', targetWorkspaceId);

    if (error) {
      console.error('Sync CRM: fetch contacts error', error);
      return NextResponse.json(
        { error: 'Failed to load leads' },
        { status: 500 }
      );
    }

    const list: ContactRow[] = contacts ?? [];
    if (list.length === 0) {
      return NextResponse.json({
        message: 'No leads to sync.',
        count: 0,
        failed: 0,
        details: {},
      });
    }

    const details: Record<string, { synced: number; failed: number }> = {};
    const providerNames: Record<string, string> = { followupboss: 'Follow Up Boss' };

    for (const conn of connections) {
      const provider = conn.provider as string;
      if (provider !== 'followupboss') continue;

      let synced = 0;
      let failed = 0;
      const apiKey = decryptApiKey(conn.api_key_encrypted);

      for (const c of list) {
        if (!c.email && !c.phone) {
          failed++;
          continue;
        }

        const { firstName, lastName } = splitFullName(c.full_name);
        const person: Record<string, unknown> = {};
        if (firstName || lastName) {
          person.firstName = firstName;
          person.lastName = lastName;
        }
        if (c.email) person.emails = [{ value: c.email }];
        if (c.phone) person.phones = [{ value: c.phone }];
        if (c.address) person.addresses = [{ street: c.address, city: '', state: '', code: '' }];
        const eventPayload = {
          source: 'FLYR',
          system: 'FLYR',
          type: 'General Inquiry',
          message: c.notes
            ? `FLYR lead${c.campaign_id ? ` (campaign ${c.campaign_id})` : ''}: ${c.notes}`
            : `Lead from FLYR${c.campaign_id ? ` campaign ${c.campaign_id}` : ''}`,
          person,
        };
        const fubRes = await fetch('https://api.followupboss.com/v1/events', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventPayload),
        });
        if (!fubRes.ok) {
          console.error('FUB push failed for contact', c.id, fubRes.status);
          failed++;
        } else {
          synced++;
        }
      }

      details[provider] = { synced, failed };

      if (synced > 0 || failed > 0) {
        await supabase
          .from('crm_connections')
          .update({
            last_push_at: new Date().toISOString(),
            status: 'connected',
            last_error: null,
          })
          .eq('workspace_id', targetWorkspaceId)
          .eq('provider', provider);
      }
    }

    const parts: string[] = [];
    for (const [provider, d] of Object.entries(details)) {
      const label = providerNames[provider] ?? provider;
      parts.push(`${d.synced} to ${label}`);
    }
    const totalSynced = Object.values(details).reduce((sum, d) => sum + d.synced, 0);
    const totalFailed = Object.values(details).reduce((sum, d) => sum + d.failed, 0);
    const message = parts.length
      ? `Synced: ${parts.join('; ')}.${totalFailed > 0 ? ` ${totalFailed} failed.` : ''}`
      : 'No leads to sync.';

    return NextResponse.json({
      message,
      count: totalSynced,
      failed: totalFailed,
      total: list.length,
      details,
    });
  } catch (e) {
    console.error('Sync to CRM error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Sync to CRM failed.' },
      { status: 500 }
    );
  }
}
