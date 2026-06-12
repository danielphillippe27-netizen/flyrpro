'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Play, Volume2 } from 'lucide-react';

declare global {
  interface Window {
    Stream?: (element: HTMLIFrameElement | null) => CloudflareStreamPlayer;
  }
}

type CloudflareStreamPlayer = {
  muted: boolean;
  play: () => Promise<void>;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
};

type DialerVideoLandingProps = {
  videoUrl?: string;
  customerCode?: string;
  videoUid?: string;
  posterUrl?: string;
  onboardingHref: string;
  redirectAtSeconds?: number;
};

function buildStreamUrl(customerCode: string, videoUid: string, posterUrl?: string) {
  const url = new URL(`https://customer-${customerCode}.cloudflarestream.com/${videoUid}/iframe`);
  url.searchParams.set('autoplay', 'true');
  url.searchParams.set('muted', 'true');
  url.searchParams.set('preload', 'auto');
  url.searchParams.set('primaryColor', '#dc2626');
  url.searchParams.set('letterboxColor', 'transparent');
  if (posterUrl) {
    url.searchParams.set('poster', posterUrl);
  }
  return url.toString();
}

export function DialerVideoLanding({
  videoUrl,
  customerCode,
  videoUid,
  posterUrl,
  onboardingHref,
  redirectAtSeconds,
}: DialerVideoLandingProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const redirectStartedRef = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [soundPromptVisible, setSoundPromptVisible] = useState(true);

  const streamUrl = useMemo(() => {
    if (!customerCode || !videoUid) return null;
    return buildStreamUrl(customerCode, videoUid, posterUrl);
  }, [customerCode, posterUrl, videoUid]);

  useEffect(() => {
    if (!videoUrl) return;

    const video = videoRef.current;
    if (!video) return;

    const startOnboarding = () => {
      if (redirectStartedRef.current) return;
      redirectStartedRef.current = true;
      video.pause();
      setRedirecting(true);
      router.push(onboardingHref);
    };

    const handleTimeUpdate = () => {
      if (!redirectAtSeconds || video.currentTime < redirectAtSeconds) return;
      startOnboarding();
    };

    video.addEventListener('ended', startOnboarding);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.muted = true;
    video.play().catch(() => undefined);

    return () => {
      video.removeEventListener('ended', startOnboarding);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [onboardingHref, redirectAtSeconds, router, videoUrl]);

  useEffect(() => {
    if (videoUrl || !scriptReady || !streamUrl || typeof window.Stream !== 'function') return;

    const player = window.Stream(iframeRef.current);
    if (!player) return;

    const handleEnded = () => {
      if (redirectStartedRef.current) return;
      redirectStartedRef.current = true;
      setRedirecting(true);
      router.push(onboardingHref);
    };

    player.addEventListener('ended', handleEnded);
    player.play().catch(() => {
      player.muted = true;
      player.play().catch(() => undefined);
    });

    return () => {
      player.removeEventListener?.('ended', handleEnded);
    };
  }, [onboardingHref, router, scriptReady, streamUrl, videoUrl]);

  const handleStartWithSound = () => {
    if (videoUrl) {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = 0;
      video.muted = false;
      video.volume = 1;
      video.play().catch(() => undefined);
      setSoundPromptVisible(false);
      return;
    }

    const player = typeof window !== 'undefined' && window.Stream ? window.Stream(iframeRef.current) : null;
    if (!player) return;
    player.muted = false;
    player.play().catch(() => undefined);
    setSoundPromptVisible(false);
  };

  if (!videoUrl && !streamUrl) {
    return (
      <main className="min-h-screen bg-zinc-950 px-5 py-8 text-white md:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-8">
          <Link href="/" className="text-4xl font-black leading-none tracking-tight text-red-500">
            FLYR
          </Link>
          <section className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-300">
              Power dialer video
            </p>
            <h1 className="mt-4 text-4xl font-black leading-tight md:text-6xl">
              Add your dialer demo video URL.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300">
              Set `NEXT_PUBLIC_DIALER_VIDEO_URL`, then this page will autoplay the CDN video
              and send viewers into the 14 day onboarding flow.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {!videoUrl && (
        <Script
          src="https://embed.cloudflarestream.com/embed/sdk.latest.js"
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
        />
      )}

      <section className="relative min-h-[100svh] overflow-hidden bg-black">
        <div className="dialer-portrait-rotator relative min-h-[100svh] bg-black">
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-end px-4 py-3 md:px-8 md:py-5">
            <Link
              href={onboardingHref}
              className="inline-flex h-10 items-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white shadow-lg shadow-red-950/30 transition hover:bg-red-500 md:h-11 md:px-5"
            >
              Start free trial
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>

          <div className="dialer-video-viewport relative mx-auto flex min-h-[100svh] w-full items-center justify-center bg-black">
            <div className="dialer-player-frame relative w-full">
              <div className="dialer-aspect relative w-full bg-black pt-[56.25%]">
                {videoUrl ? (
                  <video
                    ref={videoRef}
                    id="flyr-power-dialer-video"
                    title="FLYR power dialer demo"
                    src={videoUrl}
                    poster={posterUrl}
                    className="absolute inset-0 h-full w-full bg-black object-contain"
                    autoPlay
                    muted
                    playsInline
                    preload="auto"
                  />
                ) : (
                  <iframe
                    ref={iframeRef}
                    id="flyr-power-dialer-stream"
                    title="FLYR power dialer demo"
                    src={streamUrl ?? undefined}
                    className="absolute inset-0 h-full w-full border-0"
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                    allowFullScreen
                  />
                )}
              </div>

              {soundPromptVisible && (
                <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-5">
                  <button
                    type="button"
                    onClick={handleStartWithSound}
                    className="pointer-events-auto inline-flex h-16 items-center rounded-lg bg-white px-7 text-base font-black text-zinc-950 shadow-2xl shadow-black/40 transition hover:scale-[1.02] hover:bg-zinc-100 md:h-20 md:px-9 md:text-lg"
                  >
                    <span className="mr-4 grid h-9 w-9 place-items-center rounded-full bg-red-600 text-white md:h-10 md:w-10">
                      <Play className="h-5 w-5 fill-current" />
                    </span>
                    Play with sound
                    <Volume2 className="ml-3 h-5 w-5 text-red-600" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <style>{`
          .dialer-player-frame {
            aspect-ratio: 16 / 9;
            width: min(100vw, calc(100svh * 16 / 9));
          }

          .dialer-aspect {
            height: 100%;
            padding-top: 0;
          }

          @media (orientation: portrait) and (max-width: 767px) {
            .dialer-portrait-rotator {
              position: fixed;
              left: 50%;
              top: 50%;
              width: 100svh;
              height: 100svw;
              min-height: 100svw;
              transform: translate(-50%, -50%) rotate(90deg);
              transform-origin: center;
            }

            .dialer-video-viewport {
              height: 100svw;
              min-height: 100svw;
            }

            .dialer-player-frame {
              width: min(100svh, calc(100svw * 16 / 9));
            }
          }
        `}</style>

        {redirecting && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/90 px-6 text-center backdrop-blur">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-300">
                Starting your trial
              </p>
              <p className="mt-3 text-3xl font-black">Taking you to onboarding.</p>
            </div>
          </div>
        )}
      </section>

    </main>
  );
}
