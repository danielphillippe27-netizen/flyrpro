import Link from 'next/link';
import Image from 'next/image';

type PublicSiteHeaderProps = {
  active?: 'ambassador' | 'pricing' | 'download';
  showAmbassador?: boolean;
};

function getNavLinkClass(isActive: boolean) {
  return isActive
    ? 'text-sm font-semibold text-zinc-900'
    : 'text-sm font-medium text-zinc-600 transition hover:text-zinc-900';
}

export function PublicSiteHeader({ active, showAmbassador = true }: PublicSiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-zinc-50/90 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950/90">
      <div className="flex w-full items-center justify-between px-4 py-3 md:px-6">
        <Link href="/" className="flex items-center" aria-label="WolfGrid home">
          <Image
            src="/brand/wolfgrid-logo-text.svg"
            alt="WolfGrid"
            width={180}
            height={90}
            className="h-12 w-auto dark:hidden"
            priority
          />
          <Image
            src="/brand/wolfgrid-logo-white.svg"
            alt="WolfGrid"
            width={180}
            height={90}
            className="hidden h-12 w-auto dark:block"
            priority
          />
        </Link>

        <div className="flex items-center gap-5 md:gap-6">
          {showAmbassador && (
            <Link href="/ambassador" className={getNavLinkClass(active === 'ambassador')}>
              Ambassador
            </Link>
          )}
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
