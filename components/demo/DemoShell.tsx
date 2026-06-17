'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { initTracking, track } from '@/lib/demo/analytics/track';

const BEATS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] as const;
const GRAIN_BACKGROUND =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'180\' height=\'180\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'180\' height=\'180\' filter=\'url(%23n)\' opacity=\'1\'/%3E%3C/svg%3E")';

export function DemoShell({ children, slug }: { children: ReactNode; slug: string }) {
  const [activeBeat, setActiveBeat] = useState<(typeof BEATS)[number]>('b1');

  useEffect(() => {
    initTracking(slug);

    try {
      track('open', undefined, {
        device: navigator.userAgent.includes('Mobi') ? 'mobile' : 'desktop',
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        referrer: document.referrer || null,
      });
    } catch {
      // Analytics must never affect the demo experience.
    }
  }, [slug]);

  useEffect(() => {
    let frame = 0;
    let observer: IntersectionObserver | undefined;
    const intersectingBeats = new Set<string>();

    const registerSections = () => {
      const sections = [...document.querySelectorAll('section')].filter((section) =>
        BEATS.includes(section.id as (typeof BEATS)[number])
      );

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const beatId = entry.target.id as (typeof BEATS)[number];
            if (!BEATS.includes(beatId)) {
              return;
            }

            const beatNumber = Number(beatId.replace('b', ''));

            if (entry.isIntersecting) {
              entry.target.classList.add('in');
              setActiveBeat(beatId);

              if (!intersectingBeats.has(beatId)) {
                intersectingBeats.add(beatId);
                track('beat_enter', beatNumber);

                if (beatId === 'b6') {
                  track('cta_view', beatNumber);
                  track('complete', beatNumber);
                }
              }
            } else if (intersectingBeats.has(beatId)) {
              intersectingBeats.delete(beatId);
              track('beat_exit', beatNumber);
            }
          });
        },
        { threshold: 0.25 }
      );

      sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        const visibleRatio = visibleHeight / rect.height;

        if (visibleRatio >= 0.25) {
          section.classList.add('in');
          const beatId = section.id as (typeof BEATS)[number];
          setActiveBeat(beatId);
          intersectingBeats.add(beatId);
          const beatNumber = Number(beatId.replace('b', ''));
          track('beat_enter', beatNumber);

          if (beatId === 'b6') {
            track('cta_view', beatNumber);
            track('complete', beatNumber);
          }
        }

        observer?.observe(section);
      });
    };

    frame = requestAnimationFrame(registerSections);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        className="demo-grain"
        style={{
          backgroundImage: GRAIN_BACKGROUND,
        }}
      />
      <nav aria-label="Beats" className="demo-beat-rail">
        {BEATS.map((beat, index) => {
          const isActive = activeBeat === beat;

          return (
            <a
              key={beat}
              href={`#${beat}`}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                letterSpacing: '0.08em',
                color: isActive ? 'var(--orange)' : 'var(--paper)',
                opacity: isActive ? 1 : 0.28,
                textDecoration: 'none',
                transition: 'opacity 0.3s, color 0.3s',
              }}
            >
              {String(index + 1).padStart(2, '0')}
            </a>
          );
        })}
      </nav>
      <style jsx global>{`
        .demo-grain {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          pointer-events: none;
          z-index: 50;
          opacity: 7%;
        }

        .demo-beat-rail {
          position: fixed;
          left: 0;
          top: 0;
          bottom: 0;
          width: 54px;
          z-index: 40;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 26px;
          padding-left: 18px;
        }

        .demo-beat-rail a:focus-visible {
          outline: 2px solid var(--orange);
          outline-offset: 3px;
          opacity: 1;
        }

        @media (max-width: 760px) {
          .demo-beat-rail {
            display: none;
          }
        }
      `}</style>
      {children}
    </>
  );
}
