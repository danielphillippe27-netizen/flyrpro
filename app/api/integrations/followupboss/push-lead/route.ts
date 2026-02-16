import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
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
  metadata?: Record<string, any>;
}

export async function POST(request: NextRequest) {
  try {
    const leadData: LeadData = await request.json();

    // Validate required fields
    if (!leadData.email && !leadData.phone) {
      return NextResponse.json(
        { error: 'Email or phone is required' },
        { status: 400 }
      );
    }

    // Get current user
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the stored connection
    const { data: connection } = await supabase
      .from('crm_connections')
      .select('api_key_encrypted')
      .eq('user_id', user.id)
      .eq('provider', 'followupboss')
      .maybeSingle();

    if (!connection) {
      return NextResponse.json(
        { error: 'Follow Up Boss not connected. Please connect your account first.' },
        { status: 400 }
      );
    }

    // Decrypt the API key
    const apiKey = decryptApiKey(connection.api_key_encrypted);

    // Prepare the person data
    const person: any = {};
    if (leadData.firstName || leadData.lastName) {
      person.firstName = leadData.firstName || '';
      person.lastName = leadData.lastName || '';
    }
    if (leadData.email) person.emails = [{ value: leadData.email }];
    if (leadData.phone) person.phones = [{ value: leadData.phone }];
    if (leadData.address || leadData.city || leadData.state || leadData.zip) {
      person.addresses = [{
        street: leadData.address || '',
        city: leadData.city || '',
        state: leadData.state || '',
        code: leadData.zip || '',
      }];
    }

    // Build the event payload according to FUB's recommended format
    const eventPayload: any = {
      source: leadData.source || 'FLYR',
      system: 'FLYR',
      type: 'General Inquiry',
      message: leadData.message || `Lead from FLYR campaign${leadData.campaignId ? ` ${leadData.campaignId}` : ''}`,
      person,
    };

    // Add source URL if provided
    if (leadData.sourceUrl) {
      eventPayload.sourceUrl = leadData.sourceUrl;
    }

    // Add any additional metadata
    if (leadData.metadata) {
      eventPayload.metadata = leadData.metadata;
    }

    // Push to Follow Up Boss using POST /v1/events (recommended by FUB)
    const fubResponse = await fetch('https://api.followupboss.com/v1/events', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventPayload),
    });

    if (!fubResponse.ok) {
      const errorData = await fubResponse.text();
      console.error('FUB API error:', errorData);

      const isExpired =
        fubResponse.status === 401 &&
        /expired|renew|refresh/i.test(errorData);

      // Update connection with error
      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_error: `Push failed: ${fubResponse.status}`,
        })
        .eq('user_id', user.id)
        .eq('provider', 'followupboss');

      if (isExpired) {
        return NextResponse.json(
          {
            error: 'Follow Up Boss API key has expired. Reconnect in Settings → Integrations.',
            code: 'FUB_TOKEN_EXPIRED',
          },
          { status: 401 }
        );
      }

      return NextResponse.json(
        { error: `Failed to push lead to Follow Up Boss: ${fubResponse.status}` },
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
      .eq('user_id', user.id)
      .eq('provider', 'followupboss');

    // Save lead to contacts so it shows on the web Leads page (iOS and other push-lead callers)
    const fullName = [leadData.firstName, leadData.lastName].filter(Boolean).join(' ').trim() || (leadData.email || leadData.phone || 'Lead');
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
      message: 'Lead successfully pushed to Follow Up Boss',
      fubEventId: result.id,
    });
  } catch (error) {
    console.error('Error pushing lead to FUB:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to push lead' },
      { status: 500 }
    );
  }
}
