import Link from "next/link";
import type { ReactNode } from "react";

type LegalPageLayoutProps = {
  currentPage: "privacy" | "terms";
  title: string;
  description: string;
  effectiveDate: string;
  children: ReactNode;
};

const navLinkClass =
  "rounded-full px-4 py-2 text-sm font-medium transition hover:bg-black/[0.05]";

export function LegalPageLayout({
  currentPage,
  title,
  description,
  effectiveDate,
  children,
}: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fef2f2_0%,#ffffff_24%,#ffffff_100%)] text-zinc-900">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="flex flex-col gap-4 rounded-[28px] border border-black/10 bg-white/90 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/" className="text-3xl font-black tracking-tight text-black sm:text-4xl">
              FLYR
            </Link>
            <nav
              aria-label="Legal navigation"
              className="flex flex-wrap items-center gap-2 text-zinc-600"
            >
              <Link
                href="/terms"
                aria-current={currentPage === "terms" ? "page" : undefined}
                className={`${navLinkClass} ${
                  currentPage === "terms" ? "bg-black text-white hover:bg-black" : ""
                }`}
              >
                Terms
              </Link>
              <Link
                href="/privacy"
                aria-current={currentPage === "privacy" ? "page" : undefined}
                className={`${navLinkClass} ${
                  currentPage === "privacy" ? "bg-black text-white hover:bg-black" : ""
                }`}
              >
                Privacy
              </Link>
            </nav>
          </div>

          <header className="space-y-4 rounded-[24px] bg-gradient-to-br from-red-500 via-red-400 to-orange-300 px-5 py-8 text-white sm:px-8 sm:py-10">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/80">
              Legal
            </p>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
                {title}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-white/90 sm:text-lg">
                {description}
              </p>
            </div>
            <p className="text-sm font-medium text-white/80">Effective date: {effectiveDate}</p>
          </header>
        </div>

        <article className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.06)] sm:p-8">
          <div className="space-y-10 text-[15px] leading-7 text-zinc-700 sm:text-base">
            {children}
          </div>
        </article>

        <footer className="rounded-[24px] border border-zinc-200 bg-white px-5 py-6 text-sm text-zinc-600 shadow-[0_12px_40px_rgba(15,23,42,0.04)] sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>Public legal information for FLYR and FLYR Pro.</p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/terms" className="font-medium text-zinc-900 underline underline-offset-4">
                Terms of Service
              </Link>
              <Link href="/privacy" className="font-medium text-zinc-900 underline underline-offset-4">
                Privacy Policy
              </Link>
              <a
                href="https://www.flyrpro.app"
                className="font-medium text-zinc-900 underline underline-offset-4"
              >
                flyrpro.app
              </a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
