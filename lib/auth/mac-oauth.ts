import type { SupabaseClient } from '@supabase/supabase-js';
import { hasMacBridge, macNative } from '@/lib/mac-companion/client';

/** OAuth's verifier stays in WebKit cookies; only the public authorization URL goes native. */
export async function startProviderSignIn(api: SupabaseClient, provider: 'google' | 'apple', webCallback: string) {
  const native = hasMacBridge();
  const attempt = native ? crypto.randomUUID() : null;
  const redirectTo = native ? `wolfgrid-mac://auth/callback?attempt=${attempt}` : webCallback;
  if (native) await macNative('oauth-prepare', { attempt });
  try {
  const { data, error } = await api.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      ...(native ? { skipBrowserRedirect: true } : {}),
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Could not start sign-in. Please try again.');
  if (native) {
    await macNative('oauth', { url: data.url, attempt });
  } else {
    window.location.href = data.url;
  }
  } catch (error) {
    if (native) await macNative('oauth-cancel', { attempt }).catch(() => {});
    throw error;
  }
}
