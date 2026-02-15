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

export async function POST(request: NextRequest) {
  try {
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
        { error: 'No connection found' },
        { status: 404 }
      );
    }

    const apiToken = decryptApiKey(connection.api_key_encrypted);

    const testResponse = await fetch(`${BOLDTRAIL_API_BASE}/v2/public/contacts?limit=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!testResponse.ok) {
      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_tested_at: new Date().toISOString(),
          last_error: `API test failed: ${testResponse.status}`,
        })
        .eq('user_id', user.id)
        .eq('provider', 'boldtrail');

      return NextResponse.json(
        { error: 'API test failed. Please reconnect your account.' },
        { status: 400 }
      );
    }

    await supabase
      .from('crm_connections')
      .update({
        status: 'connected',
        last_tested_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('user_id', user.id)
      .eq('provider', 'boldtrail');

    return NextResponse.json({
      success: true,
      message: 'Connection is working properly',
    });
  } catch (error) {
    console.error('Error testing BoldTrail connection:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to test connection' },
      { status: 500 }
    );
  }
}
