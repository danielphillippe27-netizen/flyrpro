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
        { error: 'Follow Up Boss not connected. Please connect your account first.' },
        { status: 404 }
      );
    }

    // Decrypt the API key
    const apiKey = decryptApiKey(connection.api_key_encrypted);

    // Create a test lead
    const testLead = {
      source: 'FLYR',
      system: 'FLYR',
      type: 'General Inquiry',
      message: '🧪 Test lead from FLYR Integration - This is a test to verify your connection is working',
      person: {
        firstName: 'Test',
        lastName: 'Lead',
        emails: [{ value: `test-${Date.now()}@flyr.test` }],
        phones: [{ value: '(555) 123-4567' }],
      },
      metadata: {
        testLead: true,
        sentAt: new Date().toISOString(),
        source: 'FLYR Integration Test',
      },
    };

    // Push to Follow Up Boss
    const fubResponse = await fetch('https://api.followupboss.com/v1/events', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testLead),
    });

    if (!fubResponse.ok) {
      const errorData = await fubResponse.text();
      console.error('FUB test push error:', errorData);
      
      // Update connection with error
      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_error: `Test push failed: ${fubResponse.status}`,
        })
        .eq('workspace_id', targetWorkspaceId)
        .eq('provider', 'followupboss');

      return NextResponse.json(
        { error: `Failed to push test lead: ${fubResponse.status}` },
        { status: 502 }
      );
    }

    const result = await fubResponse.json();

    // Update last_push_at timestamp
    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('workspace_id', targetWorkspaceId)
      .eq('provider', 'followupboss');

    return NextResponse.json({
      success: true,
      message: 'Test lead successfully pushed to Follow Up Boss! Check your FUB account to see it.',
      fubEventId: result.id,
      testLead: {
        name: 'Test Lead',
        email: testLead.person.emails[0].value,
      },
    });
  } catch (error) {
    console.error('Error pushing test lead to FUB:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to push test lead' },
      { status: 500 }
    );
  }
}
