'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import {
  OFFER_TEMPLATES,
  toLocalDateTimeInputValue,
  type OfferTemplate,
  type PartnerOffer,
} from '@/components/offers/partnerOfferUtils';

type PartnerOffersPayload = {
  offers: PartnerOffer[];
};

export function PartnerOfferCreateForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [partnerName, setPartnerName] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [offerTitle, setOfferTitle] = useState('Exclusive Partner Offer');
  const [offerMessage, setOfferMessage] = useState(
    'Private access for your team. This page is invite-only and not publicly listed.'
  );
  const [selectedTemplate, setSelectedTemplate] = useState<OfferTemplate['id'] | null>(null);
  const [ctaLabel, setCtaLabel] = useState('Book a demo');
  const [ctaUrl, setCtaUrl] = useState('');
  const [maxViews, setMaxViews] = useState('');
  const [expiresAt, setExpiresAt] = useState(() =>
    toLocalDateTimeInputValue(new Date(Date.now() + 1000 * 60 * 60 * 24 * 14))
  );

  const [statsLoading, setStatsLoading] = useState(true);
  const [offers, setOffers] = useState<PartnerOffer[]>([]);

  const loadOffers = useCallback(async () => {
    const response = await fetch('/api/admin/offers', { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load offers');
    }
    setOffers((payload as PartnerOffersPayload).offers ?? []);
  }, []);

  useEffect(() => {
    setStatsLoading(true);
    loadOffers()
      .catch(() => setOffers([]))
      .finally(() => setStatsLoading(false));
  }, [loadOffers]);

  const activeCount = useMemo(
    () => offers.filter((offer) => offer.status === 'active').length,
    [offers]
  );

  const handleCreateOffer = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSaving(true);
      setError(null);
      try {
        const response = await fetch('/api/admin/offers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            recipientName,
            recipientEmail,
            partnerName,
            offerTitle,
            offerMessage,
            ctaLabel,
            ctaUrl,
            maxViews,
            expiresAt,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to create offer');
        }
        const offer = (payload as { offer?: PartnerOffer }).offer;
        if (offer) {
          await navigator.clipboard.writeText(offer.shareUrl).catch(() => undefined);
          router.push(`/offers/${offer.id}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create offer');
      } finally {
        setSaving(false);
      }
    },
    [
      ctaLabel,
      ctaUrl,
      expiresAt,
      maxViews,
      offerMessage,
      offerTitle,
      partnerName,
      recipientEmail,
      recipientName,
      router,
    ]
  );

  const applyTemplate = useCallback((template: (typeof OFFER_TEMPLATES)[number]) => {
    setSelectedTemplate(template.id);
    setOfferTitle(template.title);
    setOfferMessage(template.message);
    setCtaLabel(template.ctaLabel);
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total offers</CardDescription>
            <CardTitle>{statsLoading ? '…' : offers.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Active links</CardDescription>
            <CardTitle>{statsLoading ? '…' : activeCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Private path format</CardDescription>
            <CardTitle className="text-base">`/partner-offer/&lt;token&gt;`</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Create new partner offer</CardTitle>
          <CardDescription>
            Generate a unique private link and share it with one specific partner contact.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-y-2">
            <Label>Offer templates</Label>
            <div className="flex flex-wrap gap-2">
              {OFFER_TEMPLATES.map((template) => (
                <Button
                  key={template.id}
                  type="button"
                  variant={selectedTemplate === template.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => applyTemplate(template)}
                >
                  {template.label}
                </Button>
              ))}
            </div>
          </div>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCreateOffer}>
            <div className="space-y-2">
              <Label htmlFor="partnerName">Partner / Company *</Label>
              <Input
                id="partnerName"
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                placeholder="Acme Realty Group"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offerTitle">Offer title *</Label>
              <Input
                id="offerTitle"
                value={offerTitle}
                onChange={(e) => setOfferTitle(e.target.value)}
                placeholder="Exclusive Partner Offer"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipientName">Recipient name</Label>
              <Input
                id="recipientName"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Sarah Lee"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipientEmail">Recipient email</Label>
              <Input
                id="recipientEmail"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="sarah@acme.com"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="offerMessage">Offer message</Label>
              <Textarea
                id="offerMessage"
                value={offerMessage}
                onChange={(e) => setOfferMessage(e.target.value)}
                placeholder="Private message shown on the exclusive page."
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ctaLabel">CTA label</Label>
              <Input
                id="ctaLabel"
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="Book a demo"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ctaUrl">CTA URL</Label>
              <Input
                id="ctaUrl"
                type="url"
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://calendly.com/..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiresAt">Expires at *</Label>
              <Input
                id="expiresAt"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxViews">Max views (optional)</Label>
              <Input
                id="maxViews"
                type="number"
                min={1}
                value={maxViews}
                onChange={(e) => setMaxViews(e.target.value)}
                placeholder="e.g. 5"
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating link...
                  </span>
                ) : (
                  'Create private offer link'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
