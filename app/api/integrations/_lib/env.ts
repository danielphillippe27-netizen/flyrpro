const DEFAULT_CRM_SECRET = 'flyr-default-encryption-key-32chars!';

export function getCrmEncryptionKey(): string {
  return process.env.CRM_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || DEFAULT_CRM_SECRET;
}

export function getOAuthStateSecret(): string {
  return process.env.OAUTH_STATE_SECRET || getCrmEncryptionKey();
}
