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
          title: 'Download the WolfGrid iPhone app',
          description: 'Your onboarding is complete. Install the app to start knocking doors, tracking activity, and working leads on the go.',
          primaryCta: 'Download on the App Store',
          secondaryCta: 'Continue to WolfGrid on web',
        }
      : {
          title: 'Get WolfGrid on iPhone',
          description: 'Download the app for the best experience, then continue setup on the web.',
          primaryCta: 'Download on the App Store',
          secondaryCta: 'Continue setup on web',
        };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center overflow-x-hidden bg-white p-6 pb-20 text-[#17181c]">
      <div className="w-full max-w-md space-y-8 rounded-[26px] border border-[#d9dce2] bg-white p-8 shadow-[0_18px_45px_rgba(0,0,0,0.08)] sm:p-10">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="flex shrink-0 justify-center px-2">
            <Image
              src="/wolfgrid-icon-1024.png"
              alt="WolfGrid"
              width={160}
              height={160}
              className="h-36 w-auto max-w-[200px] object-contain"
              priority
            />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold leading-tight tracking-normal text-[#17181c] sm:text-4xl">
              {content.title}
            </h1>
            <p className="text-base font-semibold leading-relaxed text-[#7b7f89]">
              {content.description}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            asChild
            className="h-14 w-full rounded-xl border-0 bg-[#09090b] text-lg font-semibold text-white hover:bg-[#27272a]"
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
            className="h-12 w-full rounded-xl border-[#d9dce2] bg-white text-base font-semibold text-[#202124] hover:bg-[#f5f6f8] hover:text-[#202124]"
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
        <div className="min-h-screen bg-white flex items-center justify-center">
          <p className="text-[#6f7480]">Loading...</p>
        </div>
      }
    >
      <DownloadIosContent />
    </Suspense>
  );
}
