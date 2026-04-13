'use client';

import { Suspense, useMemo } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

const IOS_APP_STORE_URL =
  'https://apps.apple.com/ca/app/flyr/id6755614702';

type DownloadStage = 'pre-onboarding' | 'post-onboarding';

function resolveStage(raw: string | null): DownloadStage {
  return raw === 'post-onboarding' ? 'post-onboarding' : 'pre-onboarding';
}

function DownloadIosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stage = useMemo(
    () => resolveStage(searchParams.get('stage')),
    [searchParams]
  );
  const nextPath = useMemo(
    () => {
      const fallback = stage === 'post-onboarding' ? '/home' : '/onboarding';
      const raw = searchParams.get('next');
      if (!raw) return fallback;
      const trimmed = raw.trim();
      if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
      if (trimmed.includes('://')) return fallback;
      return trimmed.split('#')[0] ?? fallback;
    },
    [searchParams, stage]
  );
  const content =
    stage === 'post-onboarding'
      ? {
          title: 'Download the FLYR iPhone app',
          description: 'Your onboarding is complete. Install the app to start knocking doors, tracking activity, and working leads on the go.',
          primaryCta: 'Download on the App Store',
          secondaryCta: 'Continue to FLYR on web',
        }
      : {
          title: 'Get FLYR on iPhone',
          description: 'Download the app for the best experience, then continue setup on the web.',
          primaryCta: 'Download on the App Store',
          secondaryCta: 'Continue setup on web',
        };

  return (
    <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex flex-col items-center justify-center p-6 pb-28 relative overflow-x-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-red-950/40 via-transparent to-black/80 pointer-events-none" />
      <div className="relative w-full max-w-md space-y-8 rounded-2xl border border-white/15 bg-white/[0.06] p-8 sm:p-10 backdrop-blur-2xl shadow-[0_24px_70px_rgba(0,0,0,0.6),0_10px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.2)]">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[1.35rem] shadow-lg ring-1 ring-white/20">
            <Image
              src="/flyr-ios-app-icon.png"
              alt="FLYR app icon"
              width={112}
              height={112}
              className="object-cover"
              priority
            />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-bold leading-tight text-white">
              {content.title}
            </h1>
            <p className="text-base text-[#AAAAAA] leading-relaxed">
              {content.description}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            asChild
            className="w-full h-14 text-lg font-semibold bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
          >
            <a
              href={IOS_APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2"
            >
              {content.primaryCta}
              <ExternalLink className="h-4 w-4 opacity-90" aria-hidden />
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(nextPath)}
            className="w-full h-12 text-base border-zinc-600 text-white hover:bg-zinc-800 hover:text-white"
          >
            {content.secondaryCta}
          </Button>
        </div>

      </div>
    </div>
  );
}

export default function DownloadIosPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <DownloadIosContent />
    </Suspense>
  );
}
