import { parseCookieHeader, serializeCookieHeader, type CookieMethodsBrowser } from '@supabase/ssr';
import { isWolfGridProductionHost } from './shared-cookie';

/** Keep legacy host-only cookies from surviving a shared-cookie refresh or logout. */
export const browserAuthCookies: CookieMethodsBrowser = {
  getAll() {
    return parseCookieHeader(document.cookie).map(({ name, value }) => ({ name, value: value ?? '' }));
  },
  setAll(cookies) {
    for (const { name, value, options } of cookies) {
      if (isWolfGridProductionHost(window.location.hostname) && options.domain === '.wolfgrid.app') {
        // Without this, an invalid host-only token remains readable after the
        // SDK deletes its shared counterpart and can trigger a refresh loop.
        document.cookie = serializeCookieHeader(name, '', {
          path: options.path ?? '/', maxAge: 0, sameSite: 'lax', secure: true,
        });
      }
      document.cookie = serializeCookieHeader(name, value, options);
    }
  },
};
