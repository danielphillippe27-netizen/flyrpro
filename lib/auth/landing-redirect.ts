/** Handle auth providers that fall back to the site root after authentication. */
export function landingAuthRedirect(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const type = params.get('type') ?? fragment.get('type');
  if (type === 'recovery') return `/reset-password${search}${hash}`;

  // A PKCE code is shared by OAuth and recovery. Only an explicit recovery
  // flow belongs on the reset page; ordinary Google/Apple codes must exchange
  // through the callback, where the verifier cookie is read server-side.
  if (params.get('code')) {
    if (!params.has('next')) params.set('next', '/home');
    return `/auth/callback?${params.toString()}`;
  }

  // Retain older recovery links that used a bare token rather than a PKCE code.
  if (!type && ['token', 'token_hash'].some(key => params.has(key) || fragment.has(key))) {
    return `/reset-password${search}${hash}`;
  }
  if (params.get('error') === 'access_denied' && params.get('error_code')) {
    return `/login?error=${params.get('error_code') === 'otp_expired' ? 'reset_link_invalid' : 'auth_failed'}`;
  }
  return null;
}
