import Image from 'next/image';
import Link from 'next/link';

const footerLinks = [
  { href: '/plans', label: 'Pricing' },
  { href: '/download', label: 'Download' },
  { href: '/ambassador', label: 'Ambassador' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
];

export function PublicSiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#0b0b0b] px-5 py-10 text-white md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <Image
            src="/brand/wolfgrid-logo-white.svg"
            alt="WolfGrid"
            width={600}
            height={100}
            className="h-auto w-48"
          />
          <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-400">
            The field prospecting system for teams that want every street, conversation, and follow-up accounted for.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-zinc-400">
          {footerLinks.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-white">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-8 max-w-7xl border-t border-white/10 pt-5 text-xs text-zinc-600">
        © {new Date().getFullYear()} WolfGrid. All rights reserved.
      </div>
    </footer>
  );
}
