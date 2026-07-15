const DEFAULT_APP_ORIGIN = 'https://wolfgrid.app';
const LEGACY_PRODUCTION_HOSTS = new Set([
  'flyrpro.app',
  'www.flyrpro.app',
  'www.wolfgrid.app',
]);

/**
 * Returns the canonical public origin used in links that leave the app and
 * later return to it (OAuth, email confirmation, and password recovery).
 */
export function resolvePublicAppOrigin(fallbackOrigin?: string): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const rawOrigin = configuredOrigin || fallbackOrigin || DEFAULT_APP_ORIGIN;

  try {
    const parsed = new URL(rawOrigin);
    if (LEGACY_PRODUCTION_HOSTS.has(parsed.hostname.toLowerCase())) {
      parsed.protocol = 'https:';
      parsed.hostname = 'wolfgrid.app';
      parsed.port = '';
    }
    return parsed.origin;
  } catch {
    return fallbackOrigin || DEFAULT_APP_ORIGIN;
  }
}
