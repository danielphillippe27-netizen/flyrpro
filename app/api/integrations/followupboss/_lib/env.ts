export function getCrmEncryptionKey(): string {
  return process.env.CRM_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || 'flyr-default-encryption-key-32chars!';
}
