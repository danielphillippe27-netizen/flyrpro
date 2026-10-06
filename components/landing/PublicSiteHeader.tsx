import Link from 'next/link';
import Image from 'next/image';

type PublicSiteHeaderProps = {
  active?: 'ambassador' | 'pricing' | 'download';
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
      <div className="mx-auto flex h-[72px] w-full max-w-[1440px] items-center justify-between px-5 md:px-8">
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

        <nav className="hidden items-center gap-7 md:flex" aria-label="Public navigation">
          <Link href="/#product" className="text-sm font-medium text-zinc-600 transition hover:text-zinc-950">
            Product
          </Link>
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
