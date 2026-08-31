type CookieOptions = Record<string, unknown>;

export function isWolfGridProductionHost(hostname: string | null | undefined): boolean {
  const host = (hostname || '').split(':')[0].toLowerCase();
  return host === 'wolfgrid.app' || host.endsWith('.wolfgrid.app');
}

export function withSharedWolfGridCookie(hostname: string | null | undefined, options: CookieOptions = {}): CookieOptions {
  if (!isWolfGridProductionHost(hostname)) return options;
  return { ...options, domain: '.wolfgrid.app', path: '/', secure: true, sameSite: 'lax' };
}

export function browserSharedCookieOptions(): CookieOptions {
  if (typeof window === 'undefined') return {};
  return withSharedWolfGridCookie(window.location.hostname);
}

/**
 * Remove legacy host-only and shared Supabase cookies during the one-time
 * salesperson subdomain transition. Supabase SSR cookies are intentionally
 * readable by the browser, so both variants can be expired here before a
 * fresh password or OAuth session is created for `.wolfgrid.app`.
 */
export function clearBrowserSupabaseAuthCookies(): void {
  if (typeof document === 'undefined') return;

  const names = document.cookie
    .split(';')
    .map((entry) => entry.trim().split('=')[0])
    .filter((name) => name.startsWith('sb-') || name.startsWith('supabase-'));

  for (const name of new Set(names)) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    document.cookie = `${name}=; Max-Age=0; Domain=.wolfgrid.app; Path=/; SameSite=Lax; Secure`;
  }
}
