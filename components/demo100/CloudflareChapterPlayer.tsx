'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import { ArrowRight, Loader2, Play, RotateCcw, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Demo100StreamPlayer = {
  muted: boolean;
  play: () => Promise<void>;
  pause?: () => void;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
};

type CloudflareChapterPlayerProps = {
  customerCode?: string;
  videoUid?: string;
  title: string;
  eyebrow: string;
  firstChapter?: boolean;
  portrait?: boolean;
  onStarted?: () => void;
  onComplete: () => void;
};

function streamUrl(customerCode: string | undefined, videoUid: string) {
  const url = customerCode
    ? new URL(`https://customer-${customerCode}.cloudflarestream.com/${videoUid}/iframe`)
    : new URL(`https://iframe.videodelivery.net/${videoUid}`);
  url.searchParams.set('autoplay', 'false');
  url.searchParams.set('muted', 'false');
  url.searchParams.set('preload', 'auto');
  url.searchParams.set('primaryColor', '#ef4444');
  url.searchParams.set('letterboxColor', '#050505');
  return url.toString();
}

export function CloudflareChapterPlayer({
  customerCode,
  videoUid,
  title,
  eyebrow,
  firstChapter = false,
  portrait = false,
  onStarted,
  onComplete,
}: CloudflareChapterPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<Demo100StreamPlayer | null>(null);
  const startedRef = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(true);
  const [starting, setStarting] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const url = useMemo(() => (videoUid ? streamUrl(customerCode, videoUid) : null), [customerCode, videoUid]);

  const markStarted = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStarted?.();
  }, [onStarted]);

  const playWithSound = useCallback(async () => {
    const streamFactory = (window as typeof window & {
      Stream?: (element: HTMLIFrameElement | null) => Demo100StreamPlayer;
    }).Stream;
    const player = playerRef.current ?? streamFactory?.(iframeRef.current) ?? null;
    if (!player) return;
    playerRef.current = player;
    setStarting(true);
    setPlaybackError(false);
    try {
      player.muted = false;
      await player.play();
      markStarted();
      setNeedsGesture(false);
    } catch {
      setPlaybackError(true);
      setNeedsGesture(true);
    } finally {
      setStarting(false);
    }
  }, [markStarted]);

  useEffect(() => {
    const streamFactory = (window as typeof window & {
      Stream?: (element: HTMLIFrameElement | null) => Demo100StreamPlayer;
    }).Stream;
    if (!url || !scriptReady || typeof streamFactory !== 'function') return;
    const player = streamFactory(iframeRef.current);
    if (!player) return;
    playerRef.current = player;
    const handleEnded = () => onComplete();
    const handlePlay = () => markStarted();
    const handleError = () => {
      setPlaybackError(true);
      setNeedsGesture(true);
    };
    player.addEventListener('ended', handleEnded);
    player.addEventListener('play', handlePlay);
    player.addEventListener('error', handleError);

    if (!firstChapter) {
      player.muted = false;
      player.play().then(() => {
        markStarted();
        setNeedsGesture(false);
      }).catch(() => setNeedsGesture(true));
    }

    return () => {
      player.removeEventListener?.('ended', handleEnded);
      player.removeEventListener?.('play', handlePlay);
      player.removeEventListener?.('error', handleError);
      player.pause?.();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [firstChapter, markStarted, onComplete, scriptReady, url]);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#050505] text-white">
      <Script
        src="https://embed.cloudflarestream.com/embed/sdk.latest.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setSdkFailed(true)}
      />

      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-400">{eyebrow}</p>
          <p className="mt-1 text-sm font-bold text-white/80">{title}</p>
        </div>
        <div className="hidden items-center gap-2 text-xs font-semibold text-white/45 sm:flex">
          <span className="size-2 rounded-full bg-red-500" /> Guided WolfGrid demo
        </div>
      </div>

      {!url || sdkFailed ? (
        <div className="mx-5 max-w-xl rounded-3xl border border-white/10 bg-white/[0.05] p-8 text-center shadow-2xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-red-400">{sdkFailed ? 'Video could not load' : 'Video not connected yet'}</p>
          <h1 className="mt-4 text-3xl font-black tracking-tight">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            {sdkFailed
              ? 'The interactive demo can continue while the video service reconnects.'
              : 'This chapter is ready for its Cloudflare Stream video. Continue to preview the complete interactive flow.'}
          </p>
          <Button type="button" onClick={onComplete} className="mt-7 h-12 rounded-xl bg-red-500 px-6 font-black text-white hover:bg-red-400">
            Continue demo <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <div className={`relative mx-auto overflow-hidden bg-black shadow-2xl shadow-black ${portrait ? 'h-[min(82dvh,780px)] aspect-[9/16] rounded-[2rem] border border-white/10' : 'w-full max-w-[min(100vw,1600px)] aspect-video'}`}>
          <iframe
            ref={iframeRef}
            title={title}
            src={url}
            className="absolute inset-0 size-full border-0"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
            allowFullScreen
          />

          {needsGesture ? (
            <div className="absolute inset-0 z-10 grid place-items-center bg-black/45 px-5 backdrop-blur-[2px]">
              <button
                type="button"
                onClick={() => void playWithSound()}
                disabled={!scriptReady || starting}
                className="group inline-flex min-h-16 items-center rounded-2xl bg-white px-7 text-base font-black text-zinc-950 shadow-2xl transition hover:scale-[1.02] hover:bg-zinc-100 disabled:opacity-70"
              >
                <span className="mr-4 grid size-10 place-items-center rounded-full bg-red-500 text-white">
                  {starting ? <Loader2 className="size-5 animate-spin" /> : playbackError ? <RotateCcw className="size-5" /> : <Play className="size-5 fill-current" />}
                </span>
                {playbackError ? 'Try playing again' : firstChapter ? 'Play demo with sound' : 'Continue with sound'}
                <Volume2 className="ml-3 size-5 text-red-500" />
              </button>
              {playbackError ? (
                <button type="button" onClick={onComplete} className="absolute bottom-6 text-sm font-bold text-white/75 underline decoration-white/30 underline-offset-4 hover:text-white">
                  Skip this chapter
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
