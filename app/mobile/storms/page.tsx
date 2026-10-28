'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { StormMapWorkspace } from '@/components/storm-maps/StormMapWorkspace';
import { isMobileStormAPI, mobileStormFetch, mobileStormMapRequest, StormMobileContext, StormMobileMapContext } from '@/lib/storm-maps/mobile-session';

type Session = { workspaceId: string; center?: [number, number] };
type Bootstrap = Session & { accessToken: string };
declare global {
  interface Window { WolfGridStorms?: { start: (session: Bootstrap) => void }; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notifyNative = (path: string) => { window.location.href = `wolfgrid-storms://${path}`; };

export default function MobileStormsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [drawingRequest, setDrawingRequest] = useState(0);
  const [error, setError] = useState('');
  const [overlayHeader, setOverlayHeader] = useState(false);
  const [mapOnly, setMapOnly] = useState(false);
  const [nativeTop, setNativeTop] = useState(0);
  const accessTokenRef = useRef('');
  const [sessionRevision, setSessionRevision] = useState(0);
  const mapSession = useMemo(() => ({
    transformRequest: (url: string) => mobileStormMapRequest(url, window.location.origin, () => accessTokenRef.current, session?.workspaceId ?? ''),
    onUnauthorized: () => setError('Your session expired. Tap Reconnect, then retry your last action.'),
    revision: sessionRevision,
  }), [session?.workspaceId, sessionRevision]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setOverlayHeader(query.get('chrome') === 'overlay');
    setMapOnly(query.get('chrome') === 'map');
    setNativeTop(Math.max(0, Math.min(100, Number(query.get('inset')) || 0)));
    const original = window.fetch.bind(window);
    let accessToken = '';
    let activeWorkspace: string | null = null;
    window.WolfGridStorms = { start: incoming => {
      if (!incoming || !uuid.test(incoming.workspaceId) || !incoming.accessToken) {
        setError('Sign in and select a workspace to use Storms.'); return;
      }
      // Re-authentication may refresh credentials, but switching accounts/workspaces must reopen the page.
      if (activeWorkspace && activeWorkspace !== incoming.workspaceId) {
        setError('Workspace changed. Close Storms and open it again.'); return;
      }
      activeWorkspace = incoming.workspaceId;
      accessToken = incoming.accessToken;
      accessTokenRef.current = incoming.accessToken;
      setSessionRevision(value => value + 1);
      const authenticatedFetch = mobileStormFetch(original, window.location.origin, () => accessToken, incoming.workspaceId);
      window.fetch = async (input, init) => {
        const response = await authenticatedFetch(input, init);
        const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
        if (response.status === 401 && isMobileStormAPI(url, window.location.origin)) setError('Your session expired. Tap Reconnect, then retry your last action.');
        return response;
      };
      const center = incoming.center;
      const validCenter = Array.isArray(center) && center.length === 2 && center.every(Number.isFinite) && Math.abs(center[0]) <= 180 && Math.abs(center[1]) <= 85;
      setSession(previous => previous ?? { workspaceId: incoming.workspaceId, center: validCenter ? center : undefined });
      setError('');
    } };
    notifyNative('ready');
    const timer = setTimeout(() => { if (!activeWorkspace) setError('Could not connect to your app session. Close Storms and try again.'); }, 20000);
    return () => { clearTimeout(timer); accessToken = ''; accessTokenRef.current = ''; window.fetch = original; delete window.WolfGridStorms; };
  }, []);
  return <main data-storm-map-only={mapOnly || undefined} style={{ '--storm-native-top': `${nativeTop}px` } as CSSProperties} data-storm-overlay-header={overlayHeader || undefined} className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
    {error && <div role="alert" className="z-50 flex items-center gap-3 bg-red-950 p-3 text-sm text-white"><p className="flex-1">{error}</p><button className="min-h-11 rounded border px-3" onClick={() => notifyNative('refresh')}>Reconnect</button></div>}
    {session ? <StormMobileContext.Provider value={id => { if (uuid.test(id)) notifyNative(`campaign/${id}`); }}>
      <StormMobileMapContext.Provider value={mapSession}>
      <StormMapWorkspace key={session.workspaceId} mobile workspaceId={session.workspaceId} initialCenter={session.center} drawingRequest={drawingRequest} onStormCampaign={() => setDrawingRequest(value => value + 1)} />
      </StormMobileMapContext.Provider>
    </StormMobileContext.Provider> : !error && <p role="status" className="p-5">Connecting to Storms…</p>}
  </main>;
}
