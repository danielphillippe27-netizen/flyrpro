import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import crypto from 'crypto';

const BOLDTRAIL_API_BASE = 'https://api.kvcore.com';

// Encrypt API token using AES-256-GCM (same format as FUB)
function encryptApiKey(apiKey: string): string {
  const keyString = process.env.ENCRYPTION_KEY || 'flyr-default-encryption-key-32chars!';
  const key = Buffer.from(keyString.slice(0, 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(apiKey, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export async function POST(request: NextRequest) {
  try {
    const { apiToken } = await request.json();

    if (!apiToken || typeof apiToken !== 'string') {
      return NextResponse.json(
        { error: 'API token is required' },
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

    // Validate token with GET contacts (requires Contacts or All scope)
    const testResponse = await fetch(`${BOLDTRAIL_API_BASE}/v2/public/contacts?limit=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken.trim()}`,
        'Content-Type': 'application/json',
      },
    });

    if (!testResponse.ok) {
      if (testResponse.status === 401) {
        return NextResponse.json(
          { error: 'Invalid API token. Please check your BoldTrail token and try again.' },
          { status: 401 }
        );
      }
      if (testResponse.status === 403) {
        return NextResponse.json(
          { error: 'Use a Contacts or All API token for lead sync. This token may be User-only.' },
          { status: 403 }
        );
      }
      throw new Error(`BoldTrail API error: ${testResponse.status}`);
    }

    const encryptedKey = encryptApiKey(apiToken.trim());

    const { data: existingConnection } = await supabase
      .from('crm_connections')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'boldtrail')
      .maybeSingle();

    if (existingConnection) {
      const { error: updateError } = await supabase
        .from('crm_connections')
        .update({
          api_key_encrypted: encryptedKey,
          status: 'connected',
          updated_at: new Date().toISOString(),
          last_tested_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', existingConnection.id);

      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase
        .from('crm_connections')
        .insert({
          user_id: user.id,
          provider: 'boldtrail',
          api_key_encrypted: encryptedKey,
          status: 'connected',
          last_tested_at: new Date().toISOString(),
        });

      if (insertError) throw insertError;
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully connected to BoldTrail',
    });
  } catch (error: unknown) {
    console.error('Error connecting to BoldTrail:', error);
    const err = error as { message?: string; code?: string };
    const message =
      error instanceof Error ? error.message : typeof err?.message === 'string' ? err.message : 'Failed to connect';
    const isMissingTable =
      (err?.code === '42P01') ||
      (typeof message === 'string' && message.includes('crm_connections') && message.includes('does not exist'));
    const friendlyMessage = isMissingTable
      ? 'Database table crm_connections is missing. In Supabase Dashboard go to SQL Editor and run the script in supabase/QUICK_FIX_crm_connections.sql, then try again.'
      : message;
    return NextResponse.json({ error: friendlyMessage }, { status: 500 });
  }
}
