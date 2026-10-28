import Link from 'next/link';
import Image from 'next/image';
import { PublicFeaturesMenu } from './PublicFeaturesMenu';

type PublicSiteHeaderProps = {
  active?: 'ambassador' | 'pricing' | 'download' | 'storms';
  showAmbassador?: boolean;
  primaryAction?: { href: string; label: string };
};

function getNavLinkClass(isActive: boolean) {
  return isActive
    ? 'text-sm font-semibold text-zinc-900'
    : 'text-sm font-medium text-zinc-600 transition hover:text-zinc-900';
}

export function PublicSiteHeader({ active, showAmbassador = false, primaryAction = { href: "/login", label: "Start free" } }: PublicSiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-[#f7f5f2]/90 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-y-3 px-5 py-4 md:h-[72px] md:flex-nowrap md:px-8 md:py-0">
        <Link href="/" className="flex items-center overflow-hidden" aria-label="WolfGrid home">
          <Image
            src="/brand/wolfgrid-header-light.svg"
            alt="WolfGrid"
            width={1900}
            height={250}
            className="h-auto w-36 object-contain object-left sm:w-48 md:w-56"
            priority
          />
        </Link>

        <nav className="order-3 flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-3 md:order-none md:w-auto md:gap-7" aria-label="Public navigation">
          <Link href="/#product" className="text-sm font-medium text-zinc-600 transition hover:text-zinc-950">
            Product
          </Link>
          <PublicFeaturesMenu active={active === 'storms'} />
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
        </nav>

        <div className="flex items-center gap-2.5">
          <Link
            href="/login"
            className="hidden h-10 items-center rounded-full px-4 text-sm font-semibold text-zinc-700 transition hover:text-zinc-950 sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href={primaryAction.href}
            className="inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-full bg-zinc-950 px-3 text-xs sm:px-4 sm:text-sm font-semibold text-white transition hover:bg-red-600 md:px-5"
          >
            {primaryAction.label}
          </Link>
        </div>
      </div>
    </header>
  );
}
