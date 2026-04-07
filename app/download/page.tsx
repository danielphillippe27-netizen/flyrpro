'use client';

import Image from 'next/image';
import Link from 'next/link';

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-zinc-50/90 backdrop-blur-sm">
        <div className="flex w-full items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" className="flex items-end">
            <span className="text-4xl font-black leading-none tracking-tight text-red-600 md:text-5xl">FLYR</span>
          </Link>

          <div className="flex items-center gap-5 md:gap-6">
            <Link
              href="/plans"
              className="text-sm font-medium text-zinc-600 transition hover:text-zinc-900"
            >
              Pricing
            </Link>
            <Link
              href="/download"
              className="text-sm font-semibold text-zinc-900"
            >
              Download
            </Link>
            <Link
              href="/login"
              className="inline-flex h-9 items-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="px-5 py-14 md:px-8 md:py-16">
        <div className="mx-auto max-w-4xl text-center">
          <Image
            src="/flyr-download-icon.png"
            alt="FLYR app icon"
            width={164}
            height={164}
            className="mx-auto"
            priority
          />

          <h1 className="mt-8 text-5xl font-black tracking-tight text-zinc-900 md:text-6xl">Download FLYR</h1>
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
