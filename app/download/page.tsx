'use client';

import Image from 'next/image';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PublicSiteHeader active="download" />

      <main className="px-5 py-14 md:px-8 md:py-16">
        <div className="mx-auto max-w-4xl text-center">
          <Image
            src="/wolfgrid-icon-1024.png"
            alt="WolfGrid app icon"
            width={164}
            height={164}
            className="mx-auto"
            priority
          />

          <h1 className="mt-8 text-5xl font-black tracking-tight text-zinc-900 md:text-6xl">Download WolfGrid</h1>
          <p className="mx-auto mt-3 max-w-2xl text-xl text-zinc-600">
            Ready to turn prospecting into a system?
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href="https://apps.apple.com/ca/app/flyr/id6755614702"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center rounded-xl bg-red-600 px-6 text-base font-semibold text-white shadow-sm transition hover:bg-red-500"
            >
              Download on iOS
            </a>
          </div>

          <p className="mt-5 text-sm text-zinc-500">
            If you want to use desktop app sign in in the top right corner.
          </p>
        </div>
      </main>
    </div>
  );
}
