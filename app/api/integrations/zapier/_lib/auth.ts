import crypto from 'crypto';
import { getCrmEncryptionKey } from '@/app/api/integrations/_lib/env';

export function encryptZapierWebhookUrl(webhookUrl: string): string {
  const keyString = getCrmEncryptionKey();
  const key = Buffer.from(keyString.slice(0, 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(webhookUrl, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export function decryptZapierWebhookUrl(encryptedData: string): string {
  const keyString = getCrmEncryptionKey();
  const key = Buffer.from(keyString.slice(0, 32));
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unable to authenticate data|unsupported state/i.test(message)) {
      throw new Error('Saved Zapier webhook could not be decrypted. Reconnect Zapier and save the webhook again.');
    }
    throw error;
  }
}

export async function getZapierWebhookUrlForWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string
): Promise<string | null> {
  const { data: connection } = await supabase
    .from('crm_connections')
    .select('api_key_encrypted')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'zapier')
    .eq('status', 'connected')
    .maybeSingle();

  if (!connection?.api_key_encrypted) {
    return null;
  }

  return decryptZapierWebhookUrl(connection.api_key_encrypted);
}
