import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import crypto from 'crypto';

// Decrypt function to match the encrypt function
function decryptApiKey(encryptedData: string): string {
  const keyString = process.env.ENCRYPTION_KEY || 'flyr-default-encryption-key-32chars!';
  const key = Buffer.from(keyString.slice(0, 32));
  
  // Parse the encrypted data format: iv:authTag:encrypted
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];
  
  // Create decipher
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  // Decrypt
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

export async function POST(request: NextRequest) {
  try {
    // Get current user
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let requestedWorkspaceId: string | null = null;
    try {
      const body = await request.json();
      requestedWorkspaceId = body?.workspaceId ?? null;
    } catch {
      requestedWorkspaceId = null;
    }

    const workspaceResolution = await resolveWorkspaceIdForUser(supabase as any, user.id, requestedWorkspaceId);
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }
    const targetWorkspaceId = workspaceResolution.workspaceId;

    // Get the stored connection
    const { data: connection } = await supabase
      .from('crm_connections')
      .select('api_key_encrypted')
      .eq('workspace_id', targetWorkspaceId)
      .eq('provider', 'followupboss')
      .maybeSingle();

    if (!connection) {
      return NextResponse.json(
        { error: 'No connection found' },
        { status: 404 }
      );
    }

    // Decrypt and test the API key
    const apiKey = decryptApiKey(connection.api_key_encrypted);
    
    const testResponse = await fetch('https://api.followupboss.com/v1/users', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });

    if (!testResponse.ok) {
      // Update status to error
      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_tested_at: new Date().toISOString(),
          last_error: `API test failed: ${testResponse.status}`,
        })
        .eq('workspace_id', targetWorkspaceId)
        .eq('provider', 'followupboss');

      return NextResponse.json(
        { error: 'API test failed. Please reconnect your account.' },
        { status: 400 }
      );
    }

    // Update last tested timestamp
    await supabase
      .from('crm_connections')
      .update({
        status: 'connected',
        last_tested_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('workspace_id', targetWorkspaceId)
      .eq('provider', 'followupboss');

    return NextResponse.json({
      success: true,
      message: 'Connection is working properly',
    });
  } catch (error) {
    console.error('Error testing FUB connection:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to test connection' },
      { status: 500 }
    );
  }
}
