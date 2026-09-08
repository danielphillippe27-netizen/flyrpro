'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import {
  ArrowRight,
  Check,
  ChevronRight,
  LockKeyhole,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type Demo100StreamPlayer = {
  muted: boolean;
  currentTime: number;
  duration: number;
  play: () => Promise<void>;
  pause?: () => void;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
};

export type IphoneChapter = {
  title: string;
  summary: string;
  startSeconds: number;
};

type IphoneChapterExperienceProps = {
  chapters: readonly IphoneChapter[];
  customerCode?: string;
  videoUid?: string;
  onComplete: () => void;
  onChapterStarted?: (chapterIndex: number) => void;
  onChapterCompleted?: (chapterIndex: number) => void;
};

function streamUrl(customerCode: string | undefined, videoUid: string) {
  const url = customerCode
    ? new URL(`https://customer-${customerCode}.cloudflarestream.com/${videoUid}/iframe`)
    : new URL(`https://iframe.videodelivery.net/${videoUid}`);
  url.searchParams.set('autoplay', 'true');
  url.searchParams.set('muted', 'true');
  url.searchParams.set('controls', 'false');
  url.searchParams.set('preload', 'auto');
  url.searchParams.set('primaryColor', '#ef4444');
  url.searchParams.set('letterboxColor', '#000000');
  return url.toString();
}

export function IphoneChapterExperience({
  chapters,
  customerCode,
  videoUid,
  onComplete,
  onChapterStarted,
  onChapterCompleted,
}: IphoneChapterExperienceProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<Demo100StreamPlayer | null>(null);
  const pendingSeekSecondsRef = useRef<number | null>(null);
  const startedIndexesRef = useRef<Set<number>>(new Set());
  const completedIndexesRef = useRef<Set<number>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [highestUnlockedIndex, setHighestUnlockedIndex] = useState(0);
  const [completedIndexes, setCompletedIndexes] = useState<Set<number>>(() => new Set());
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [scriptReady, setScriptReady] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const activeChapter = chapters[activeIndex];
  const url = useMemo(
    () => videoUid ? streamUrl(customerCode, videoUid) : null,
    [customerCode, videoUid],
  );

  useEffect(() => {
    const streamFactory = (window as typeof window & {
      Stream?: (element: HTMLIFrameElement | null) => Demo100StreamPlayer;
    }).Stream;
    if (typeof streamFactory === 'function') setScriptReady(true);
  }, []);

  const markStarted = useCallback((chapterIndex: number) => {
    if (startedIndexesRef.current.has(chapterIndex)) return;
    startedIndexesRef.current.add(chapterIndex);
    onChapterStarted?.(chapterIndex);
  }, [onChapterStarted]);

  const markCompleted = useCallback((chapterIndex: number) => {
    if (completedIndexesRef.current.has(chapterIndex)) return;
    completedIndexesRef.current.add(chapterIndex);
    setCompletedIndexes(new Set(completedIndexesRef.current));
    onChapterCompleted?.(chapterIndex);
  }, [onChapterCompleted]);

  const goToChapter = useCallback((chapterIndex: number) => {
    const safeIndex = Math.max(0, Math.min(chapters.length - 1, chapterIndex));
    const player = playerRef.current;
    const startSeconds = chapters[safeIndex]?.startSeconds ?? 0;
    if (player && Number.isFinite(player.duration) && player.duration > 0) {
      player.currentTime = Math.min(startSeconds, player.duration);
      pendingSeekSecondsRef.current = null;
      void player.play().catch(() => undefined);
    } else {
      pendingSeekSecondsRef.current = startSeconds;
    }
    setActiveIndex(safeIndex);
    setHighestUnlockedIndex((current) => Math.max(current, safeIndex));
    markStarted(safeIndex);
  }, [chapters, markStarted]);

  const advance = useCallback(() => {
    markCompleted(activeIndex);
    if (activeIndex >= chapters.length - 1) {
      onComplete();
      return;
    }
    goToChapter(activeIndex + 1);
  }, [activeIndex, chapters.length, goToChapter, markCompleted, onComplete]);

  useEffect(() => {
    const streamFactory = (window as typeof window & {
      Stream?: (element: HTMLIFrameElement | null) => Demo100StreamPlayer;
    }).Stream;
    if (!url || !scriptReady || typeof streamFactory !== 'function') return;
    const player = streamFactory(iframeRef.current);
    if (!player) return;
    playerRef.current = player;
    const syncToPlayback = () => {
      if (!Number.isFinite(player.duration) || player.duration <= 0) return;
      const ratio = Math.max(0, Math.min(1, player.currentTime / player.duration));
      let chapterIndex = 0;
      for (let index = 1; index < chapters.length; index += 1) {
        if (player.currentTime < chapters[index].startSeconds) break;
        chapterIndex = index;
      }
      setPlaybackProgress(ratio * 100);
      setActiveIndex(chapterIndex);
      setHighestUnlockedIndex((current) => Math.max(current, chapterIndex));
      for (let index = 0; index < chapterIndex; index += 1) markCompleted(index);
      markStarted(chapterIndex);
    };
    const handleEnded = () => {
      for (let index = 0; index < chapters.length; index += 1) markCompleted(index);
      setActiveIndex(chapters.length - 1);
      setHighestUnlockedIndex(chapters.length - 1);
      setPlaybackProgress(100);
    };
    const handlePlay = () => syncToPlayback();
    const handleLoadedMetadata = () => {
      const pendingSeekSeconds = pendingSeekSecondsRef.current;
      if (pendingSeekSeconds !== null && Number.isFinite(player.duration) && player.duration > 0) {
        player.currentTime = Math.min(pendingSeekSeconds, player.duration);
        pendingSeekSecondsRef.current = null;
        void player.play().catch(() => undefined);
      }
      syncToPlayback();
    };
    player.addEventListener('ended', handleEnded);
    player.addEventListener('play', handlePlay);
    player.addEventListener('timeupdate', syncToPlayback);
    player.addEventListener('loadedmetadata', handleLoadedMetadata);
    player.muted = true;
    player.play()
      .then(() => markStarted(0))
      .catch(() => undefined);

    return () => {
      player.removeEventListener?.('ended', handleEnded);
      player.removeEventListener?.('play', handlePlay);
      player.removeEventListener?.('timeupdate', syncToPlayback);
      player.removeEventListener?.('loadedmetadata', handleLoadedMetadata);
      player.pause?.();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [chapters, markCompleted, markStarted, scriptReady, url]);

  if (!activeChapter) return null;

  const progress = playbackProgress;

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-[#050505] text-white">
      <Script
        src="https://embed.cloudflarestream.com/embed/sdk.latest.js"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setSdkFailed(true)}
      />

      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1440px] flex-col px-4 pb-6 pt-[max(5rem,calc(env(safe-area-inset-top)+4rem))] sm:px-6 lg:h-[100dvh] lg:flex-row lg:gap-8 lg:overflow-hidden lg:px-10 lg:pb-6 lg:pt-16">
        <section className="flex min-h-0 flex-1 flex-col lg:max-w-[600px]">
          <div className="shrink-0">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-400">iPhone field guide</p>
                <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] sm:text-4xl">Learn WolfGrid at the door.</h1>
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-black text-zinc-300">
                {completedIndexes.size}/{chapters.length}
              </span>
            </div>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-red-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <ol className="mt-5 grid min-h-0 gap-2 overflow-visible pb-2 sm:grid-cols-2 lg:flex-1 lg:grid-cols-1 lg:overflow-y-auto lg:pr-3">
            {chapters.map((chapter, index) => {
              const locked = index > highestUnlockedIndex;
              const active = index === activeIndex;
              const complete = completedIndexes.has(index);
              return (
                <li key={`${chapter.title}-${index}`}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => goToChapter(index)}
                    aria-current={active ? 'step' : undefined}
                    aria-label={locked ? `${chapter.title}, locked` : `Open ${chapter.title}`}
                    className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border px-3.5 py-3.5 text-left transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                      active
                        ? 'border-red-500/70 bg-red-500/12 shadow-[0_0_0_1px_rgba(239,68,68,.12)]'
                        : complete
                          ? 'border-white/12 bg-white/[0.055] hover:bg-white/[0.09]'
                          : 'border-white/8 bg-white/[0.035]'
                    } ${locked ? 'cursor-not-allowed' : ''}`}
                  >
                    <span className={`grid size-9 shrink-0 place-items-center rounded-xl text-xs font-black ${active ? 'bg-red-500 text-white' : complete ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/8 text-zinc-400'}`}>
                      {complete ? <Check className="size-4" /> : index + 1}
                    </span>
                    <span className={`min-w-0 flex-1 transition duration-300 ${locked ? 'select-none blur-[5px] opacity-35' : ''}`}>
                      <span className="block truncate text-sm font-black text-white">{chapter.title}</span>
                      <span className="mt-0.5 block truncate text-xs font-medium text-zinc-500">{chapter.summary}</span>
                    </span>
                    {locked ? <LockKeyhole className="size-4 shrink-0 text-zinc-700" /> : <ChevronRight className={`size-4 shrink-0 transition ${active ? 'translate-x-0 text-red-400' : '-translate-x-1 text-zinc-700 group-hover:translate-x-0 group-hover:text-zinc-400'}`} />}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mt-8 flex min-w-0 flex-1 flex-col items-center justify-center lg:mt-0">
          <div className="w-full max-w-[480px]">
            <div className="relative mx-auto aspect-[9/16] h-[min(78dvh,880px)] max-w-full overflow-hidden rounded-[3.5rem] border-[8px] border-[#202126] bg-black shadow-[0_30px_90px_rgba(0,0,0,.75),0_0_0_1px_rgba(255,255,255,.16)]">
              <div className="pointer-events-none absolute left-1/2 top-2 z-30 h-7 w-28 -translate-x-1/2 rounded-full bg-black" />
              {url && !sdkFailed ? (
                <iframe
                  ref={iframeRef}
                  title="WolfGrid iPhone walkthrough video"
                  src={url}
                  className="pointer-events-none absolute inset-0 size-full border-0"
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_28%,rgba(239,68,68,.2),transparent_35%),linear-gradient(180deg,#17181c,#070708)] px-7 text-center">
                  <div>
                    <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-red-500 shadow-xl shadow-red-950/40"><Play className="size-6 fill-current" /></span>
                    <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-red-300">Feature preview</p>
                    <p className="mt-2 text-xl font-black">{activeChapter.title}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">{activeChapter.summary}</p>
                  </div>
                </div>
              )}

            </div>

            <Button
              type="button"
              onClick={advance}
              className="mt-8 h-[3.25rem] w-full rounded-2xl bg-red-500 text-sm font-black text-white shadow-xl shadow-red-950/25 hover:bg-red-400"
            >
              {activeIndex === chapters.length - 1 ? 'Finish iPhone guide' : `Next · ${chapters[activeIndex + 1]?.title}`}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
