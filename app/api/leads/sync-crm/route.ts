import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOLDTRAIL_API_BASE = 'https://api.kvcore.com';

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
 * Syncs the current user's leads/contacts to all connected CRMs (Follow Up Boss, BoldTrail).
 */
export async function POST() {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: connections } = await supabase
      .from('crm_connections')
      .select('provider, api_key_encrypted')
      .eq('user_id', user.id)
      .eq('status', 'connected');

    if (!connections || connections.length === 0) {
      return NextResponse.json(
        { error: 'No CRM connected. Connect Follow Up Boss or BoldTrail in Settings → Integrations first.' },
        { status: 400 }
      );
    }

    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, full_name, phone, email, address, campaign_id, notes')
      .eq('user_id', user.id);

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
    const providerNames: Record<string, string> = { followupboss: 'Follow Up Boss', boldtrail: 'BoldTrail' };

    for (const conn of connections) {
      const provider = conn.provider as string;
      if (provider !== 'followupboss' && provider !== 'boldtrail') continue;

      let synced = 0;
      let failed = 0;
      const apiKey = decryptApiKey(conn.api_key_encrypted);

      for (const c of list) {
        if (!c.email && !c.phone) {
          failed++;
          continue;
        }

        if (provider === 'followupboss') {
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
        } else {
          // boldtrail
          const nameParts = splitFullName(c.full_name);
          const name = nameParts.firstName || nameParts.lastName
            ? [nameParts.firstName, nameParts.lastName].filter(Boolean).join(' ')
            : (c.email || c.phone || 'Lead');
          const contactPayload: Record<string, unknown> = {
            name,
            email: c.email || undefined,
            source: 'FLYR',
          };
          if (c.phone) contactPayload.phone = c.phone;
          if (c.address) contactPayload.address = c.address;
          const btRes = await fetch(`${BOLDTRAIL_API_BASE}/v2/public/contacts`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(contactPayload),
          });
          if (!btRes.ok) {
            console.error('BoldTrail push failed for contact', c.id, btRes.status);
            failed++;
          } else {
            synced++;
          }
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
          .eq('user_id', user.id)
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
