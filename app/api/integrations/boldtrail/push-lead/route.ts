import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import crypto from 'crypto';

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

interface LeadData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  message?: string;
  source?: string;
  sourceUrl?: string;
  campaignId?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const leadData: LeadData = await request.json();

    if (!leadData.email && !leadData.phone) {
      return NextResponse.json(
        { error: 'Email or phone is required' },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data: connection } = await supabase
      .from('crm_connections')
      .select('api_key_encrypted')
      .eq('user_id', user.id)
      .eq('provider', 'boldtrail')
      .maybeSingle();

    if (!connection) {
      return NextResponse.json(
        { error: 'BoldTrail not connected. Please connect your account first.' },
        { status: 400 }
      );
    }

    const apiToken = decryptApiKey(connection.api_key_encrypted);

    const nameParts = [
      leadData.firstName || '',
      leadData.lastName || '',
    ].filter(Boolean);
    const name = nameParts.length ? nameParts.join(' ') : (leadData.email || leadData.phone || 'Lead');

    const contactPayload: Record<string, unknown> = {
      name,
      email: leadData.email || undefined,
      source: leadData.source || 'FLYR',
    };
    if (leadData.phone) contactPayload.phone = leadData.phone;
    if (leadData.address || leadData.city || leadData.state || leadData.zip) {
      contactPayload.address = [leadData.address, leadData.city, leadData.state, leadData.zip].filter(Boolean).join(', ');
    }

    const btResponse = await fetch(`${BOLDTRAIL_API_BASE}/v2/public/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contactPayload),
    });

    if (!btResponse.ok) {
      const errorData = await btResponse.text();
      console.error('BoldTrail API error:', errorData);

      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_error: `Push failed: ${btResponse.status}`,
        })
        .eq('user_id', user.id)
        .eq('provider', 'boldtrail');

      return NextResponse.json(
        { error: `Failed to push lead to BoldTrail: ${btResponse.status}` },
        { status: 502 }
      );
    }

    const result = await btResponse.json().catch(() => ({}));

    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('user_id', user.id)
      .eq('provider', 'boldtrail');

    // Save lead to contacts so it shows on the web Leads page (iOS and other push-lead callers)
    const fullName = nameParts.length ? nameParts.join(' ').trim() : (leadData.email || leadData.phone || 'Lead');
    const addressStr = [leadData.address, leadData.city, leadData.state, leadData.zip].filter(Boolean).join(', ');
    await supabase.from('contacts').insert({
      user_id: user.id,
      full_name: fullName,
      phone: leadData.phone || null,
      email: leadData.email || null,
      address: addressStr || '',
      campaign_id: leadData.campaignId || null,
      status: 'new',
      notes: leadData.message || null,
    });

    return NextResponse.json({
      success: true,
      message: 'Lead successfully pushed to BoldTrail',
      contactId: result?.id ?? result?.data?.id,
    });
  } catch (error) {
    console.error('Error pushing lead to BoldTrail:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to push lead' },
      { status: 500 }
    );
  }
}
