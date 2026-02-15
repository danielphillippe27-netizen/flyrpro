import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import crypto from 'crypto';

// Encrypt API key using AES-256-GCM
function encryptApiKey(apiKey: string): string {
  // Get encryption key from env (must be 32 bytes for AES-256)
  const keyString = process.env.ENCRYPTION_KEY || 'flyr-default-encryption-key-32chars!';
  const key = Buffer.from(keyString.slice(0, 32));
  
  // Generate random IV (12 bytes for GCM)
  const iv = crypto.randomBytes(12);
  
  // Create cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  // Encrypt
  let encrypted = cipher.update(apiKey, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  // Get auth tag (16 bytes for GCM)
  const authTag = cipher.getAuthTag();
  
  // Combine IV + authTag + encrypted data
  // Format: iv:authTag:encrypted
  const result = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      );
    }

    // FUB API keys (fka_...) are 40+ characters; reject truncated or invalid length to avoid storing broken keys
    const FUB_MIN_KEY_LENGTH = 40;
    if (apiKey.length < FUB_MIN_KEY_LENGTH) {
      return NextResponse.json(
        {
          error: `API key looks incomplete (${apiKey.length} characters). Follow Up Boss keys are usually 40+ characters. Please copy the full key from Follow Up Boss → Admin → API.`,
        },
        { status: 400 }
      );
    }

    // Debug: log length only (do not log full key in production)
    console.log('FUB API Key length:', apiKey.length);

    // Get current user
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Test the API key by calling FUB's users endpoint
    const testResponse = await fetch('https://api.followupboss.com/v1/users', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });

    if (!testResponse.ok) {
      if (testResponse.status === 401) {
        return NextResponse.json(
          { error: 'Invalid API key. Please check your Follow Up Boss API key and try again.' },
          { status: 401 }
        );
      }
      throw new Error(`FUB API error: ${testResponse.status}`);
    }

    // API key is valid - encrypt and store
    const encryptedKey = encryptApiKey(apiKey);

    // Check if connection already exists (.maybeSingle() so 0 rows returns null instead of throwing)
    const { data: existingConnection } = await supabase
      .from('crm_connections')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'followupboss')
      .maybeSingle();

    if (existingConnection) {
      // Update existing connection
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

      if (updateError) {
        throw updateError;
      }
    } else {
      // Create new connection
      const { error: insertError } = await supabase
        .from('crm_connections')
        .insert({
          user_id: user.id,
          provider: 'followupboss',
          api_key_encrypted: encryptedKey,
          status: 'connected',
          last_tested_at: new Date().toISOString(),
        });

      if (insertError) {
        throw insertError;
      }
    }

    // After writing to crm_connections, also write to user_integrations so the iOS Edge Function (crm_sync) can find the token.
    // Store the full API key (no truncation). user_integrations.api_key must be TEXT, not VARCHAR(n).
    const { error: integrationError } = await supabase
      .from('user_integrations')
      .upsert(
        {
          user_id: user.id,
          provider: 'fub',
          api_key: apiKey, // full key, 40+ chars; column must be TEXT
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' }
      );

    if (integrationError) {
      console.error('Failed to write to user_integrations:', integrationError);
      // Don't fail the whole request, just log it
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully connected to Follow Up Boss',
    });
  } catch (error: unknown) {
    console.error('Error connecting to FUB:', error);
    const err = error as { message?: string; details?: string; code?: string; hint?: string };
    let message =
      error instanceof Error ? error.message : typeof err?.message === 'string' ? err.message : 'Failed to connect';
    // Friendly message when crm_connections table is missing (migration not applied)
    const isMissingTable =
      err?.code === '42P01' ||
      (typeof message === 'string' && message.includes('crm_connections') && message.includes('does not exist'));
    if (isMissingTable) {
      message =
        'Database table crm_connections is missing. In Supabase Dashboard go to SQL Editor and run the script in supabase/QUICK_FIX_crm_connections.sql, then try again.';
    }
    const isDev = process.env.NODE_ENV === 'development';
    const body: { error: string; details?: string; code?: string; hint?: string } = { error: message };
    if (isDev && error && typeof error === 'object' && !isMissingTable) {
      if (err.details) body.details = err.details;
      if (err.code) body.code = err.code;
      if (err.hint) body.hint = err.hint;
    }
    return NextResponse.json(body, { status: 500 });
  }
}
