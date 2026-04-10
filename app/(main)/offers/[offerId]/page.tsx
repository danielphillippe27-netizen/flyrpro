'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PartnerOfferDetailPanel } from '@/components/offers/PartnerOfferDetailPanel';
import type { PartnerOffer } from '@/components/offers/partnerOfferUtils';

export default function OfferDetailPage() {
  const params = useParams();
  const router = useRouter();
  const offerId = typeof params?.offerId === 'string' ? params.offerId : '';
  const [offer, setOffer] = useState<PartnerOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOffer = useCallback(async () => {
    if (!offerId) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/offers/${offerId}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load offer');
      }
      setOffer(data.offer ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load offer');
      setOffer(null);
    } finally {
      setLoading(false);
    }
  }, [offerId]);

  useEffect(() => {
    setLoading(true);
    void loadOffer();
  }, [loadOffer]);

  const handleRevoked = useCallback(() => {
    void loadOffer();
    window.dispatchEvent(new CustomEvent('flyr-offers-refresh'));
  }, [loadOffer]);

  if (!offerId) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[320px] text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (error || !offer) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] px-6 text-center">
        <p className="text-sm text-destructive mb-4">{error ?? 'Offer not found.'}</p>
        <button
          type="button"
          className="text-sm text-primary underline"
          onClick={() => router.push('/offers')}
        >
          Back to offers
        </button>
      </div>
    );
  }

  return <PartnerOfferDetailPanel offer={offer} onRevoked={handleRevoked} />;
}
