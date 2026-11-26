'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Play, Volume2 } from 'lucide-react';

type DialerVideoLandingProps = {
  videoUrl: string;
  posterUrl?: string;
  videoOrientation?: 'landscape' | 'portrait';
  videoTitle?: string;
  onboardingHref: string;
  primaryCtaLabel?: string;
  founderCallHref: string;
  endCtaEyebrow?: string;
  endCtaTitle?: string;
  showFounderCallButton?: boolean;
  redirectAtSeconds?: number;
  mutedAutoplay?: boolean;
  referralCode?: string;
  trackingSource?: string;
  trackingCampaign?: string;
  demoLinkToken?: string;
};

type DemoEventType =
  | 'page_view'
  | 'video_started'
  | 'play_with_sound'
  | 'progress_25'
  | 'progress_50'
  | 'progress_75'
  | 'video_complete'
  | 'cta_shown'
  | 'start_trial_click'
  | 'founder_call_click'
  | 'page_exit';

export function DialerVideoLanding({
  videoUrl,
  posterUrl,
  videoOrientation = 'landscape',
  videoTitle = 'WolfGrid power dialer demo',
  onboardingHref,
  primaryCtaLabel = 'Start with one campaign included',
  founderCallHref,
  endCtaEyebrow = 'Your map starts here',
  endCtaTitle = 'Create your custom 3D prospecting map.',
  showFounderCallButton = true,
  redirectAtSeconds,
  mutedAutoplay = false,
  referralCode,
  trackingSource,
  trackingCampaign,
  demoLinkToken,
}: DialerVideoLandingProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ctaShownRef = useRef(false);
  const sessionIdRef = useRef<string>('');
  const sentEventsRef = useRef<Set<string>>(new Set());
  const maxWatchSecondsRef = useRef(0);
  const watchSecondsRef = useRef(0);
  const durationSecondsRef = useRef(0);
  const [showEndCtas, setShowEndCtas] = useState(false);
  const [soundPromptVisible, setSoundPromptVisible] = useState(true);
  const isPortraitVideo = videoOrientation === 'portrait';

  const getSessionId = useCallback(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return sessionIdRef.current;
  }, []);

  const sendDemoEvent = useCallback(
    (
      eventType: DemoEventType,
      metadata?: Record<string, string | number | boolean | null>,
      useBeacon = false
    ) => {
      if (!referralCode) return;

      const body = JSON.stringify({
        eventType,
        referralCode,
        demoLinkToken,
        sessionId: getSessionId(),
        source: trackingSource,
        campaign: trackingCampaign,
        watchSeconds: watchSecondsRef.current,
        maxWatchSeconds: maxWatchSecondsRef.current,
        videoDurationSeconds: durationSecondsRef.current,
        metadata,
      });

      if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/salesperson/demo-events', blob);
        return;
      }

      void fetch('/api/salesperson/demo-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: useBeacon,
      }).catch(() => undefined);
    },
    [demoLinkToken, getSessionId, referralCode, trackingCampaign, trackingSource]
  );

  const sendOnce = useCallback(
    (eventType: DemoEventType, metadata?: Record<string, string | number | boolean | null>) => {
      if (sentEventsRef.current.has(eventType)) return;
      sentEventsRef.current.add(eventType);
      sendDemoEvent(eventType, metadata);
    },
    [sendDemoEvent]
  );

  const handlePlaybackProgress = useCallback(
    (currentSeconds: number, durationSeconds?: number) => {
      const current = Number.isFinite(currentSeconds) ? Math.max(0, currentSeconds) : 0;
      const duration =
        typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
          ? Math.max(0, durationSeconds)
          : 0;

      watchSecondsRef.current = Math.round(current);
      maxWatchSecondsRef.current = Math.max(maxWatchSecondsRef.current, Math.round(current));
      if (duration > 0) durationSecondsRef.current = Math.round(duration);

      if (duration > 0) {
        const percent = current / duration;
        if (percent >= 0.25) sendOnce('progress_25');
        if (percent >= 0.5) sendOnce('progress_50');
        if (percent >= 0.75) sendOnce('progress_75');
      }
    },
    [sendOnce]
  );

  const showCtas = useCallback((video?: HTMLVideoElement | null, reason: 'threshold' | 'complete' = 'threshold') => {
    if (ctaShownRef.current) return;
    ctaShownRef.current = true;
    video?.pause();
    sendOnce('cta_shown', { reason });
    setSoundPromptVisible(false);
    setShowEndCtas(true);
  }, [sendOnce]);

  useEffect(() => {
    sendOnce('page_view');
  }, [sendOnce]);

  useEffect(() => {
    const handleExit = () => {
      sendDemoEvent('page_exit', { reason: 'page_exit' }, true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sendDemoEvent('page_exit', { reason: 'visibility_hidden' }, true);
      }
    };

    window.addEventListener('pagehide', handleExit);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handleExit);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sendDemoEvent]);

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    handlePlaybackProgress(video.currentTime, video.duration);
    if (!redirectAtSeconds || video.currentTime < redirectAtSeconds) return;
    showCtas(video, 'threshold');
  };

  const handleVideoEnded = () => {
    const video = videoRef.current;
    if (video) handlePlaybackProgress(video.currentTime, video.duration);
    sendOnce('video_complete');
    showCtas(video, 'complete');
  };

  const handleVideoPlay = () => {
    sendOnce('video_started', { player: 'html_video' });
  };

  const handleStartWithSound = () => {
    const video = videoRef.current;
    if (!video) return;
    sendOnce('play_with_sound');
    video.currentTime = 0;
    video.muted = false;
    video.volume = 1;
    void video.play().then(() => setSoundPromptVisible(false)).catch(() => undefined);
  };

  const handleStartTrialClick = (location: 'top' | 'end_modal') => {
    sendDemoEvent('start_trial_click', { location });
    window.location.assign(onboardingHref);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <section className="relative min-h-[100dvh] overflow-hidden bg-black">
        <div
          className={`${
            isPortraitVideo ? 'dialer-native-portrait' : 'dialer-portrait-rotator'
          } relative min-h-[100dvh] bg-black`}
        >
          <div className="dialer-top-cta absolute inset-x-0 top-0 z-20 flex items-center justify-end px-4 py-3 md:px-8 md:py-5">
            <a
              href={onboardingHref}
              onClick={(event) => {
                event.preventDefault();
                handleStartTrialClick('top');
              }}
              className="inline-flex min-h-11 max-w-[min(92vw,34rem)] items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-center text-sm font-semibold leading-snug text-white shadow-lg shadow-red-950/30 transition hover:bg-red-500 md:min-h-12 md:px-5"
            >
              {primaryCtaLabel}
              <ArrowRight className="ml-2 h-4 w-4 shrink-0" />
            </a>
          </div>

          <div className="dialer-video-viewport relative mx-auto flex min-h-[100dvh] w-full items-center justify-center bg-black">
            <div
              className={`${
                isPortraitVideo ? 'dialer-player-frame-portrait' : 'dialer-player-frame'
              } relative w-full`}
            >
              <div className="dialer-aspect relative w-full bg-black pt-[56.25%]">
                <video
                  ref={videoRef}
                  id="flyr-power-dialer-video"
                  title={videoTitle}
                  src={videoUrl}
                  poster={posterUrl}
                  className="absolute inset-0 h-full w-full bg-black object-contain"
                  autoPlay={mutedAutoplay}
                  muted={mutedAutoplay}
                  playsInline
                  controls={!soundPromptVisible}
                  preload={mutedAutoplay ? 'auto' : 'metadata'}
                  controlsList="nodownload noplaybackrate noremoteplayback"
                  disablePictureInPicture
                  disableRemotePlayback
                  onEnded={handleVideoEnded}
                  onPlay={handleVideoPlay}
                  onTimeUpdate={handleVideoTimeUpdate}
                />
              </div>

              {soundPromptVisible && (
                <div className="pointer-events-auto absolute inset-0 z-10 grid place-items-center px-5">
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
            width: min(100vw, calc(100dvh * 16 / 9));
          }

          .dialer-player-frame-portrait {
            aspect-ratio: 9 / 16;
            width: min(100vw, calc(100dvh * 9 / 16));
            max-height: 100dvh;
          }

          .dialer-aspect {
            height: 100%;
            padding-top: 0;
          }

          @media (orientation: portrait) and (max-width: 767px) {
            .dialer-native-portrait .dialer-top-cta {
              display: none;
            }

            .dialer-native-portrait,
            .dialer-native-portrait .dialer-video-viewport {
              min-height: 100dvh;
              height: 100dvh;
            }

            .dialer-native-portrait .dialer-player-frame-portrait {
              height: min(100dvh, calc(100vw * 16 / 9));
              width: min(100vw, calc(100dvh * 9 / 16));
            }

            .dialer-portrait-rotator {
              position: fixed;
              left: 50%;
              top: 50%;
              width: 100dvh;
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
              width: min(100dvh, calc(100svw * 16 / 9));
            }
          }
        `}</style>

        {showEndCtas && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/92 px-6 text-center backdrop-blur">
            <div className="w-full max-w-xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-300">
                {endCtaEyebrow}
              </p>
              <p className="mt-3 text-3xl font-black leading-tight md:text-5xl">
                {endCtaTitle}
              </p>
              <div className={`mt-8 grid gap-3 ${showFounderCallButton ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
                {showFounderCallButton ? (
                  <a
                    href={founderCallHref}
                    onClick={() => sendDemoEvent('founder_call_click', { location: 'end_modal' })}
                    className="inline-flex min-h-14 items-center justify-center rounded-lg border border-white/15 bg-white px-5 text-sm font-black text-zinc-950 shadow-2xl shadow-black/30 transition hover:bg-zinc-100"
                  >
                    <CalendarDays className="mr-2 h-4 w-4 text-red-600" />
                    Schedule a call
                  </a>
                ) : null}
                <a
                  href={onboardingHref}
                  onClick={(event) => {
                    event.preventDefault();
                    handleStartTrialClick('end_modal');
                  }}
                  className="inline-flex min-h-14 items-center justify-center rounded-lg bg-red-600 px-5 py-3 text-center text-sm font-black leading-snug text-white shadow-2xl shadow-red-950/30 transition hover:bg-red-500"
                >
                  {primaryCtaLabel}
                  <ArrowRight className="ml-2 h-4 w-4 shrink-0" />
                </a>
              </div>
            </div>
          </div>
        )}
      </section>

    </main>
  );
}
