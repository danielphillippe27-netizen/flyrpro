'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PanelLeft } from 'lucide-react';
import { OfferListSidebar } from '@/components/offers/OfferListSidebar';
import { CampaignsPageHeader } from '@/components/campaigns/CampaignsPageHeader';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
  const [mobileListOpen, setMobileListOpen] = useState(false);
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

  useEffect(() => {
    setMobileListOpen(false);
  }, [pathname]);

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
        <div className="hidden md:flex shrink-0">
          <OfferListSidebar
            onNewOffer={() => router.push('/offers/new')}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsedPersisted(!collapsed)}
            width={SIDEBAR_WIDTH}
          />
        </div>
        <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
          <SheetContent side="left" className="w-[min(100vw,22rem)] p-0 md:hidden">
            <SheetHeader className="border-b border-border px-4 py-4 text-left">
              <SheetTitle className="text-base">Offers</SheetTitle>
              <SheetDescription>Browse offers or create a new private link.</SheetDescription>
            </SheetHeader>
            <div className="flex h-full min-h-0 flex-col">
              <OfferListSidebar
                onNewOffer={() => {
                  setMobileListOpen(false);
                  router.push('/offers/new');
                }}
                width={SIDEBAR_WIDTH}
                variant="mobile"
                onNavigate={() => setMobileListOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
          <CampaignsPageHeader title={headerTitle} />
          <div className="border-b border-border bg-background px-4 py-2 md:hidden">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setMobileListOpen(true)}
            >
              <PanelLeft className="h-4 w-4" />
              Browse offers
            </Button>
          </div>
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
