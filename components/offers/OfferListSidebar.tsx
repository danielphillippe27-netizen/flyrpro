'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, Search, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';
import { formatLongDate, statusLabel, type PartnerOffer } from '@/components/offers/partnerOfferUtils';

type PartnerOffersPayload = {
  offers: PartnerOffer[];
};

type TabKey = 'active' | 'ended';

interface OfferListSidebarProps {
  onNewOffer?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  width?: number;
}

export function OfferListSidebar({
  onNewOffer,
  collapsed = false,
  onToggleCollapse,
  width = 280,
}: OfferListSidebarProps) {
  const pathname = usePathname();
  const [offers, setOffers] = useState<PartnerOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabKey>('active');

  const loadOffers = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/offers', { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load offers');
      }
      setOffers((payload as PartnerOffersPayload).offers ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load');
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOffers();
  }, [loadOffers, pathname]);

  useEffect(() => {
    const handler = () => void loadOffers();
    window.addEventListener('flyr-offers-refresh', handler);
    return () => window.removeEventListener('flyr-offers-refresh', handler);
  }, [loadOffers]);

  const byTab = useMemo(() => {
    const active = offers.filter((o) => o.status === 'active');
    const ended = offers.filter((o) => o.status !== 'active');
    return { active, ended };
  }, [offers]);

  const filtered = useMemo(() => {
    const list = tab === 'active' ? byTab.active : byTab.ended;
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter(
      (o) =>
        (o.offerTitle || '').toLowerCase().includes(q) ||
        (o.partnerName || '').toLowerCase().includes(q) ||
        (o.recipientEmail || '').toLowerCase().includes(q) ||
        (o.recipientName || '').toLowerCase().includes(q)
    );
  }, [byTab.active, byTab.ended, tab, search]);

  const activeId = pathname?.startsWith('/offers/')
    ? pathname.split('/')[2]
    : null;
  const validDetail =
    activeId && activeId !== 'new' && /^[0-9a-f-]{36}$/i.test(activeId) ? activeId : null;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => handleWheelScrollContainer(e, el);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  if (collapsed) {
    return (
      <aside className="shrink-0 flex flex-col bg-white dark:bg-[#0f0f10] w-9 h-12 items-center justify-center border-b border-border -mt-px">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="Show offer list"
          title="Show offer list"
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="shrink-0 flex flex-col border-r border-border bg-white dark:bg-sidebar transition-[width] duration-200 ease-out overflow-hidden"
      style={{ width }}
    >
      <div className="p-3 pb-3 border-b border-border">
        <div className="flex items-center justify-end gap-2 mb-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0 ml-auto"
            aria-label="Hide offer list"
            title="Hide offer list"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search offers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-background border-border"
            />
          </div>
          <Button
            size="icon"
            className="h-8 w-8 shrink-0 bg-red-600 text-white hover:bg-red-700 rounded-md"
            type="button"
            onClick={onNewOffer}
            aria-label="New offer"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-2 pt-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex flex-col flex-1 min-h-0 w-full">
          <TabsList className="w-full grid grid-cols-2 h-8 bg-muted/50 dark:bg-muted/30 p-0.5 rounded-lg">
            <TabsTrigger value="active" className="text-xs font-medium rounded-md">
              Active ({byTab.active.length})
            </TabsTrigger>
            <TabsTrigger value="ended" className="text-xs font-medium rounded-md">
              Ended ({byTab.ended.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="active"
            className="mt-0 flex flex-1 min-h-0 flex-col overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden"
          >
            <div
              ref={scrollContainerRef}
              className="overflow-y-auto min-h-0 flex-1 pt-0 -mx-3 px-3 overscroll-contain"
            >
              {loading ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">Loading...</div>
              ) : loadError ? (
                <div className="px-3 py-4 text-sm text-destructive">{loadError}</div>
              ) : (
                <ul className="pb-2">
                  {filtered.map((offer) => {
                    const isSelected = validDetail === offer.id;
                    return (
                      <li key={offer.id}>
                        <Link
                          href={`/offers/${offer.id}`}
                          className={cn(
                            'block px-3 py-2 text-sm border-l-2 -ml-px transition-colors',
                            isSelected
                              ? 'border-primary bg-primary/10 dark:bg-primary/15 text-foreground font-medium'
                              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-muted/30'
                          )}
                        >
                          <div className="truncate font-medium">{offer.offerTitle}</div>
                          <div className="truncate text-xs opacity-80">{offer.partnerName}</div>
                          <div className="truncate text-[10px] opacity-70">
                            Expires {formatLongDate(offer.expiresAt)}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!loading && !loadError && filtered.length === 0 && (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  {byTab.active.length === 0 ? 'No active offers' : 'No matches'}
                </div>
              )}
            </div>
          </TabsContent>
          <TabsContent
            value="ended"
            className="mt-0 flex flex-1 min-h-0 flex-col overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden"
          >
            <div className="overflow-y-auto min-h-0 flex-1 pt-0 -mx-3 px-3 overscroll-contain">
              {loading ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">Loading...</div>
              ) : loadError ? (
                <div className="px-3 py-4 text-sm text-destructive">{loadError}</div>
              ) : (
                <ul className="pb-2">
                  {filtered.map((offer) => {
                    const isSelected = validDetail === offer.id;
                    return (
                      <li key={offer.id}>
                        <Link
                          href={`/offers/${offer.id}`}
                          className={cn(
                            'block px-3 py-2 text-sm border-l-2 -ml-px transition-colors',
                            isSelected
                              ? 'border-primary bg-primary/10 dark:bg-primary/15 text-foreground font-medium'
                              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-muted/30'
                          )}
                        >
                          <div className="truncate font-medium">{offer.offerTitle}</div>
                          <div className="truncate text-xs opacity-80">{offer.partnerName}</div>
                          <div className="truncate text-[10px] opacity-70">{statusLabel(offer.status)}</div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!loading && !loadError && filtered.length === 0 && (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  {byTab.ended.length === 0 ? 'No ended offers' : 'No matches'}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
