import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import crypto from 'crypto';
import { getCrmEncryptionKey } from '../_lib/env';

const FUB_SYSTEM_NAME = process.env.FUB_SYSTEM_NAME || 'FLYR';
const FUB_SYSTEM_KEY = process.env.FUB_SYSTEM_KEY;

// Encrypt API key using AES-256-GCM
function encryptApiKey(apiKey: string): string {
  // Get encryption key from env (must be 32 bytes for AES-256)
  const keyString = getCrmEncryptionKey();
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
    const body = await request.json();
    const apiKey =
      typeof body?.apiKey === 'string'
        ? body.apiKey
        : typeof body?.api_key === 'string'
          ? body.api_key
          : '';
    const workspaceId = body?.workspaceId ?? null;

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      );
    }

    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const userId = requestUser.id;
    const supabase = createAdminClient();

    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      userId,
      workspaceId ?? null
    );
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }
    const targetWorkspaceId = workspaceResolution.workspaceId;

    // Test the API key by calling FUB's users endpoint
    const testResponse = await fetch('https://api.followupboss.com/v1/users', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
        'X-System': FUB_SYSTEM_NAME,
        ...(FUB_SYSTEM_KEY ? { 'X-System-Key': FUB_SYSTEM_KEY } : {}),
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
      .eq('workspace_id', targetWorkspaceId)
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
          user_id: userId,
          workspace_id: targetWorkspaceId,
          provider: 'followupboss',
          api_key_encrypted: encryptedKey,
          status: 'connected',
          last_tested_at: new Date().toISOString(),
        });

      if (insertError) {
        throw insertError;
      }
    }

    // API-key mode should override OAuth mode for this user.
    const { error: integrationDeleteError } = await supabase
      .from('user_integrations')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'fub');

    if (integrationDeleteError) {
      console.warn('Failed to clear user_integrations OAuth row:', integrationDeleteError);
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
