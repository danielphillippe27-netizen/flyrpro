'use client';

import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { ArrowRight, Loader2, Play, RotateCcw, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SiteVideo } from '@/lib/demo/siteVideos';

type ChapterVideoPlayerProps = {
  video?: SiteVideo;
  title: string;
  eyebrow: string;
  showChapterHeader?: boolean;
  autoPlayWithSound?: boolean;
  startLabel?: string;
  holdAtEnd?: boolean;
  stopAtSeconds?: number;
  completionOverlay?: ReactNode;
  onStarted?: () => void;
  onComplete: () => void;
};

async function playWithTimeout(player: HTMLVideoElement) {
  let timeout = 0;
  try {
    await Promise.race([
      player.play(),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error('Video playback timed out')), 8_000);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function ChapterVideoPlayer({
  video,
  title,
  eyebrow,
  showChapterHeader = true,
  autoPlayWithSound = false,
  startLabel,
  holdAtEnd = false,
  stopAtSeconds,
  completionOverlay,
  onStarted,
  onComplete,
}: ChapterVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const [needsGesture, setNeedsGesture] = useState(!autoPlayWithSound);
  const [starting, setStarting] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);

  function complete() {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }

  function handlePlaying() {
    if (!startedRef.current) {
      startedRef.current = true;
      onStarted?.();
    }
    setPlaybackError(false);
    setNeedsGesture(false);
    setStarting(false);
  }

  function handleError() {
    setPlaybackError(true);
    setNeedsGesture(true);
  }

  function handleTimeUpdate(event: SyntheticEvent<HTMLVideoElement>) {
    const player = event.currentTarget;
    if (completedRef.current || stopAtSeconds === undefined || player.currentTime < stopAtSeconds) return;
    player.pause();
    if (player.currentTime > stopAtSeconds + 0.05) player.currentTime = stopAtSeconds;
    complete();
  }

  function handleEnded(event: SyntheticEvent<HTMLVideoElement>) {
    const player = event.currentTarget;
    if (holdAtEnd && Number.isFinite(player.duration) && player.duration > 0) {
      player.currentTime = Math.max(0, player.duration - 0.15);
      player.pause();
    }
    complete();
  }

  async function playWithSound() {
    const player = videoRef.current;
    if (!player) return;
    setStarting(true);
    setPlaybackError(false);
    try {
      if (player.error) player.load();
      player.muted = false;
      await playWithTimeout(player);
    } catch {
      handleError();
    } finally {
      setStarting(false);
    }
  }

  const src = video?.src;
  useEffect(() => {
    const player = videoRef.current;
    if (!player || !autoPlayWithSound) return;
    let active = true;
    void playWithTimeout(player).catch((error: unknown) => {
      if (!active) return;
      setNeedsGesture(true);
      if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') {
        setPlaybackError(true);
      }
    });
    return () => {
      active = false;
    };
  }, [autoPlayWithSound, src]);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#050505] text-white">
      {showChapterHeader ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-4 bg-gradient-to-b from-black/75 via-black/25 to-transparent px-5 pb-16 pt-5 sm:px-8">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-400">{eyebrow}</p>
            <p className="mt-1 text-sm font-bold text-white/80">{title}</p>
          </div>
          <div className="hidden items-center gap-2 text-xs font-semibold text-white/45 sm:flex">
            <span className="size-2 rounded-full bg-red-500" /> Guided WolfGrid demo
          </div>
        </div>
      ) : null}

      {!video ? (
        <div className="mx-5 max-w-xl rounded-3xl border border-white/10 bg-white/[0.05] p-8 text-center shadow-2xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-red-400">Video unavailable</p>
          <h1 className="mt-4 text-3xl font-black tracking-tight">{title}</h1>
          {completionOverlay ? (
            <div className="mt-7">{completionOverlay}</div>
          ) : (
            <Button type="button" onClick={complete} className="mt-7 h-12 rounded-xl bg-red-500 px-6 font-black text-white hover:bg-red-400">
              Continue demo <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black">
          <div className="relative aspect-video w-[min(100vw,177.78dvh)] overflow-hidden bg-black">
            <video
              ref={videoRef}
              title={title}
              src={video.src}
              poster={video.poster}
              className="absolute inset-0 size-full bg-black object-contain"
              controls={!completionOverlay}
              playsInline
              preload="metadata"
              onPlaying={handlePlaying}
              onEnded={handleEnded}
              onTimeUpdate={handleTimeUpdate}
              onError={handleError}
            >
              {video.captions ? (
                <track kind="captions" srcLang="en" label="English" src={video.captions} />
              ) : null}
            </video>
            {completionOverlay ? (
              <div className="absolute inset-x-0 bottom-[30%] z-20 flex justify-center px-4 sm:bottom-[31%]">
                {completionOverlay}
              </div>
            ) : null}
          </div>

          {needsGesture ? (
            <div className="absolute inset-0 z-10 grid place-items-center bg-black/45 px-5 backdrop-blur-[2px]">
              <button
                type="button"
                onClick={() => void playWithSound()}
                disabled={starting}
                className="group inline-flex min-h-16 items-center rounded-2xl bg-white px-7 text-base font-black text-zinc-950 shadow-2xl transition hover:scale-[1.02] hover:bg-zinc-100 disabled:opacity-70"
              >
                <span className="mr-4 grid size-10 place-items-center rounded-full bg-red-500 text-white">
                  {starting ? <Loader2 className="size-5 animate-spin" /> : playbackError ? <RotateCcw className="size-5" /> : <Play className="size-5 fill-current" />}
                </span>
                {playbackError ? 'Try playing again' : autoPlayWithSound ? 'Play with sound' : startLabel ?? 'Continue with sound'}
                <Volume2 className="ml-3 size-5 text-red-500" />
              </button>
              {playbackError ? (
                <button type="button" onClick={complete} className="absolute bottom-6 text-sm font-bold text-white/75 underline decoration-white/30 underline-offset-4 hover:text-white">
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
