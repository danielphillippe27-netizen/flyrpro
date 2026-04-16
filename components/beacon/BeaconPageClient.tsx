'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Flag, Radio, UserRound, WifiOff } from 'lucide-react';
import type { PublicBeaconPayload } from '@/lib/beacon/public';
import { BeaconLiveMap } from '@/components/beacon/BeaconLiveMap';

const POLL_INTERVAL_MS = 15000;
const STALE_AFTER_MS = 5 * 60 * 1000;

function formatRelativeTime(value?: string | null) {
  if (!value) return 'No updates yet';

  const diffMs = Math.max(0, Date.now() - new Date(value).getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `Updated ${hours}h ${minutes}m ${seconds}s ago`;
  if (minutes > 0) return `Updated ${minutes}m ${seconds}s ago`;
  return `Updated ${seconds}s ago`;
}

function getViewerName(payload: PublicBeaconPayload) {
  const value = payload.share?.viewer_label?.trim();
  return value && value.length > 0 ? value : 'Your contact';
}

function getLastSignalAt(payload: PublicBeaconPayload) {
  return payload.latest_heartbeat?.recorded_at ?? payload.session?.start_time ?? payload.share?.created_at;
}

function getStatusCopy(payload: PublicBeaconPayload) {
  const lastSignalAt = getLastSignalAt(payload);
  const lastSignalMs = lastSignalAt ? new Date(lastSignalAt).getTime() : null;
  const isStale = lastSignalMs ? Date.now() - lastSignalMs > STALE_AFTER_MS : true;
  const hasMovement = Boolean(payload.latest_heartbeat);

  if (!payload.active) {
    return {
      banner: 'This safety link is no longer active.',
      tone: 'stale' as const,
      label: 'Status',
      value: 'Link inactive',
    };
  }

  if (!hasMovement) {
    return {
      banner: 'Beacon sharing has started. Live location will appear once this session begins moving.',
      tone: 'stale' as const,
      label: 'Status',
      value: 'Awaiting movement',
    };
  }

  if (isStale) {
    return {
      banner: 'We have not received a recent safety update from this device. The phone may be offline or low on battery.',
      tone: 'stale' as const,
      label: 'Status',
      value: 'Waiting for check-in',
    };
  }

  return {
    banner: 'Safety updates are coming through normally.',
    tone: 'live' as const,
    label: 'Status',
    value: payload.session?.is_paused ? 'Paused' : 'Actively sharing',
  };
}

function getDistanceCopy(payload: PublicBeaconPayload) {
  const meters = payload.session?.distance_meters;
  if (!meters || meters <= 0) return 'Location will appear here once movement begins.';
  return `${(meters / 1000).toFixed(2)} km covered so far.`;
}

type Props = {
  token: string;
  initialPayload: PublicBeaconPayload;
};

export function BeaconPageClient({ token, initialPayload }: Props) {
  const [payload, setPayload] = useState(initialPayload);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/beacon/${token}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Beacon request failed with ${response.status}`);
        }

        const next = (await response.json()) as PublicBeaconPayload;
        if (!cancelled) {
          setPayload(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not refresh Beacon');
        }
      }
    };

    const intervalId = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [token]);

  const viewerName = useMemo(() => getViewerName(payload), [payload]);
  const updatedCopy = useMemo(() => formatRelativeTime(getLastSignalAt(payload)), [payload]);
  const status = useMemo(() => getStatusCopy(payload), [payload]);
  const safetyMessage = payload.safety_events?.[0]?.message;
  const bannerCopy = error ? 'Safety updates are temporarily unavailable.' : safetyMessage ?? status.banner;

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-white/15 bg-black">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
          <Image
            src="/flyr-logo-white.svg"
            alt="FLYR"
            width={86}
            height={32}
            className="h-8 w-auto"
            priority
          />
          <div className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-[#f35a17]">
            Beacon
          </div>
        </div>
      </header>

      <div
        className={`px-4 py-3 text-sm leading-5 ${
          error || status.tone === 'stale' ? 'bg-[#ff5a13]' : status.tone === 'live' ? 'bg-[#137a39]' : 'bg-[#5a5a5a]'
        }`}
      >
        <div className="mx-auto max-w-md">{bannerCopy}</div>
      </div>

      <section className="bg-[#f4f4f8] text-[#151515]">
        <div className="mx-auto max-w-md px-6 py-10 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#e2e2ea] text-[#ffffff]">
            <UserRound className="h-10 w-10" strokeWidth={1.8} />
          </div>

          <h1 className="mt-7 text-[28px] font-medium leading-tight">{viewerName}</h1>
          <p className="mx-auto mt-3 max-w-xs text-[17px] leading-6 text-[#2d2d2d]">
            is sharing safety updates and live location with you during this session.
          </p>

          <div className="mt-7 text-center">
            <p className="text-sm text-[#8d8d96]">{updatedCopy}</p>
            <p className="text-[15px] font-semibold text-[#151515]">
              {status.label} {status.value}
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-black">
        <div className="mx-auto max-w-md px-6 py-9 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center text-white/90">
            <Radio className="h-8 w-8" strokeWidth={1.8} />
          </div>
          <h2 className="mt-4 text-[32px] leading-none tracking-tight text-white">Beacon</h2>
          <p className="mt-4 text-lg text-white/72">A simple way to keep someone informed while you are out in the field.</p>
        </div>
      </section>

      <section className="bg-black">
        <div className="mx-auto max-w-md px-6 pb-10 pt-3 text-center">
          <p className="text-[15px] font-semibold text-white">Live location</p>
          <p className="mx-auto mt-3 max-w-sm text-base leading-7 text-white/68">{getDistanceCopy(payload)}</p>
          <div className="mt-5">
            <BeaconLiveMap payload={payload} />
          </div>
        </div>

        <div className="mx-auto grid max-w-md gap-12 px-6 pb-16 text-center">
          <article>
            <div className="mx-auto flex h-10 w-10 items-center justify-center text-white/85">
              <WifiOff className="h-6 w-6" strokeWidth={1.8} />
            </div>
            <p className="mx-auto mt-4 max-w-sm text-[22px] leading-tight text-white">
              We will flag missed updates or low battery conditions.
            </p>
            <p className="mx-auto mt-3 max-w-sm text-lg leading-7 text-white/68">
              If the device stops reporting for too long, this page will make that visible right away.
            </p>
          </article>

          <article>
            <div className="mx-auto flex h-10 w-10 items-center justify-center text-white/85">
              <Flag className="h-6 w-6" strokeWidth={1.8} />
            </div>
            <p className="mx-auto mt-4 max-w-sm text-[22px] leading-tight text-white">
              Important safety moments appear here as soon as they are recorded.
            </p>
            <p className="mx-auto mt-3 max-w-sm text-lg leading-7 text-white/68">
              Check-ins, missed prompts, and urgent alerts stay visible without requiring sign-in.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
