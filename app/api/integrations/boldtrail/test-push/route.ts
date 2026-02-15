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
        { error: 'BoldTrail not connected. Please connect your account first.' },
        { status: 404 }
      );
    }

    const apiToken = decryptApiKey(connection.api_key_encrypted);
    const testEmail = `test-${Date.now()}@flyr.test`;

    const contactPayload = {
      name: 'Test Lead',
      email: testEmail,
      source: 'FLYR',
    };

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
      console.error('BoldTrail test push error:', btResponse.status, errorData);

      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_error: `Test push failed: ${btResponse.status}`,
        })
        .eq('user_id', user.id)
        .eq('provider', 'boldtrail');

      return NextResponse.json(
        { error: `Failed to push test lead: ${btResponse.status}. Check that your token has Contacts or All scope.` },
        { status: 502 }
      );
    }

    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('user_id', user.id)
      .eq('provider', 'boldtrail');

    return NextResponse.json({
      success: true,
      message: 'Test lead successfully pushed to BoldTrail! Check your BoldTrail account to see it.',
      testLead: {
        name: 'Test Lead',
        email: testEmail,
      },
    });
  } catch (error) {
    console.error('Error pushing test lead to BoldTrail:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to push test lead' },
      { status: 500 }
    );
  }
}
