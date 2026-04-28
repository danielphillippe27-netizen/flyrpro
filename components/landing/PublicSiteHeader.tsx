import Link from 'next/link';

type PublicSiteHeaderProps = {
  active?: 'ambassador' | 'pricing' | 'download';
};

function getNavLinkClass(isActive: boolean) {
  return isActive
    ? 'text-sm font-semibold text-zinc-900'
    : 'text-sm font-medium text-zinc-600 transition hover:text-zinc-900';
}

export function PublicSiteHeader({ active }: PublicSiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-zinc-50/90 backdrop-blur-sm">
      <div className="flex w-full items-center justify-between px-4 py-3 md:px-6">
        <Link href="/" className="flex items-end">
          <span className="text-4xl font-black leading-none tracking-tight text-red-600 md:text-5xl">
            FLYR
          </span>
        </Link>

        <div className="flex items-center gap-5 md:gap-6">
          <Link href="/ambassador" className={getNavLinkClass(active === 'ambassador')}>
            Ambassador
          </Link>
          <Link href="/plans" className={getNavLinkClass(active === 'pricing')}>
            Pricing
          </Link>
          <Link href="/download" className={getNavLinkClass(active === 'download')}>
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
  );
}
