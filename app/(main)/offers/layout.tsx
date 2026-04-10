'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { OfferListSidebar } from '@/components/offers/OfferListSidebar';
import { CampaignsPageHeader } from '@/components/campaigns/CampaignsPageHeader';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';

const OFFER_SIDEBAR_COLLAPSED_KEY = 'flyr-offer-sidebar-collapsed';
const SIDEBAR_WIDTH = 280;

function OffersFounderGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/access/state', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.accessLevel === 'founder') setOk(true);
        else {
          setOk(false);
          router.replace('/home');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOk(false);
          router.replace('/home');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (ok === null) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[320px] text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!ok) return null;
  return <>{children}</>;
}

function useOffersHeaderTitle() {
  const pathname = usePathname();
  const [offerTitle, setOfferTitle] = useState<string | null>(null);
  const segments = pathname?.split('/').filter(Boolean) ?? [];
  const maybeId = segments[0] === 'offers' ? segments[1] : null;
  const isDetail =
    maybeId && maybeId !== 'new' && /^[0-9a-f-]{36}$/i.test(maybeId) ? maybeId : null;

  useEffect(() => {
    if (!isDetail) {
      setOfferTitle(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/offers/${isDetail}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { offer?: { offerTitle?: string } } | null) => {
        if (!cancelled && data?.offer) setOfferTitle(data.offer.offerTitle ?? 'Offer');
      })
      .catch(() => {
        if (!cancelled) setOfferTitle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isDetail]);

  if (pathname === '/offers/new') return 'New offer';
  if (pathname === '/offers') return 'Partner Offers';
  if (isDetail && offerTitle) return offerTitle;
  if (isDetail) return 'Offer';
  return 'Partner Offers';
}

export default function OffersLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const headerTitle = useOffersHeaderTitle();

  useEffect(() => {
    try {
      const stored = localStorage.getItem(OFFER_SIDEBAR_COLLAPSED_KEY);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch {}
  }, []);

  const setCollapsedPersisted = useCallback((value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(OFFER_SIDEBAR_COLLAPSED_KEY, String(value));
    } catch {}
  }, []);

  const mainContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mainContentRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => handleWheelScrollContainer(e, el);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <OffersFounderGuard>
      <div className="flex flex-1 h-full min-h-0 w-full overflow-hidden">
        <OfferListSidebar
          onNewOffer={() => router.push('/offers/new')}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsedPersisted(!collapsed)}
          width={SIDEBAR_WIDTH}
        />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
          <CampaignsPageHeader title={headerTitle} />
          <div
            ref={mainContentRef}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain h-full"
          >
            {children}
          </div>
        </div>
      </div>
    </OffersFounderGuard>
  );
}
