export const FUB_CONNECTION_PROVIDER = 'fub';
export const FUB_CONNECTION_PROVIDERS = ['followupboss', 'fub'] as const;

export function isFubConnectionProvider(provider: string | null | undefined): boolean {
  return provider === 'followupboss' || provider === 'fub';
}
