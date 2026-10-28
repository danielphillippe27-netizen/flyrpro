'use client';
import { createContext, useContext } from 'react';
import type { RequestTransformFunction } from 'mapbox-gl';

/** Native app owns navigation; no account tokens or refresh tokens are persisted by this page. */
export const StormMobileContext = createContext<((campaignId: string) => void) | null>(null);
export const useStormMobileNavigation = () => useContext(StormMobileContext);
export const StormMobileMapContext = createContext<{
  transformRequest: RequestTransformFunction;
  onUnauthorized: () => void;
  revision: number;
} | null>(null);

/** Raster requests can run in a Mapbox worker, outside the page's fetch wrapper. */
export function mobileStormMapRequest(url: string, origin: string, token: () => string, workspaceId: string): ReturnType<RequestTransformFunction> {
  const target = new URL(url, origin);
  if (target.origin !== origin || target.pathname !== '/api/storm-maps/intelligence/wind/map') return { url };
  target.searchParams.set('workspaceId', workspaceId);
  const accessToken = token();
  return { url: target.toString(), headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} };
}

export function isMobileStormAPI(url: URL, origin: string): boolean {
  return url.origin === origin && (
    url.pathname === '/api/storm-maps/settings' ||
    url.pathname === '/api/storm-maps/manifest' ||
    url.pathname.startsWith('/api/storm-maps/intelligence/') ||
    url.pathname === '/api/campaigns' || url.pathname === '/api/campaigns/provision'
  );
}

export function mobileStormFetch(original: typeof fetch, origin: string, token: () => string, workspaceId: string): typeof fetch {
  return async (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), origin), init);
    const url = new URL(request.url);
    if (!isMobileStormAPI(url, origin)) return original(input, init);
    if (url.pathname.startsWith('/api/storm-maps/')) url.searchParams.set('workspaceId', workspaceId);
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token()}`);
    // Never send the app session through a redirect or mix it with web account cookies.
    // Buffer small JSON payloads: streaming Request bodies are not portable across WKWebView,
    // Android WebView, and HTTP/1.1. Preserve the body, method and cancellation explicitly.
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
    return original(url, { method: request.method, headers, body, signal: request.signal,
      credentials: 'omit', redirect: 'error', cache: 'no-store' });
  };
}
