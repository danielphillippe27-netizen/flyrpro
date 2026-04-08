'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Loader2 } from 'lucide-react';

type OfferStatus = 'active' | 'expired' | 'revoked' | 'maxed';

type PartnerOffer = {
  id: string;
  recipientName: string | null;
  recipientEmail: string | null;
  partnerName: string;
  offerTitle: string;
  offerMessage: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  maxViews: number | null;
  viewCount: number;
  expiresAt: string;
  lastViewedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: OfferStatus;
  shareUrl: string;
};

type PartnerOffersPayload = {
  offers: PartnerOffer[];
};

type OfferTemplate = {
  id: 'team-partner' | 'solo-agent' | 'affiliate';
  label: string;
  title: string;
  message: string;
  ctaLabel: string;
};

const OFFER_TEMPLATES: OfferTemplate[] = [
  {
    id: 'team-partner',
    label: 'Team Partner Offer',
    title: 'Exclusive Team Offer',
    message:
      'Private access for your team. This page is invite-only and not publicly listed.',
    ctaLabel: 'Book team onboarding',
  },
  {
    id: 'solo-agent',
    label: 'Solo Agent Partner Offer',
    title: 'Exclusive Solo Agent Offer',
    message:
      'Placeholder: special solo-agent pricing and setup support to help you launch quickly.',
    ctaLabel: 'Claim solo offer',
  },
  {
    id: 'affiliate',
    label: 'Affiliate Partner Offer',
    title: 'Exclusive Affiliate Partner Offer',
    message:
      'Placeholder: affiliate collaboration terms, referral incentives, and campaign support details.',
    ctaLabel: 'Review affiliate terms',
  },
];

function formatLongDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function toLocalDateTimeInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function statusVariant(status: OfferStatus): 'default' | 'destructive' | 'secondary' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'revoked') return 'destructive';
  if (status === 'maxed') return 'secondary';
  return 'outline';
}

function statusLabel(status: OfferStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'revoked') return 'Revoked';
  if (status === 'maxed') return 'View limit reached';
  return 'Expired';
}

function buildOutreachCopy(offer: PartnerOffer) {
  const recipient = offer.recipientName || offer.recipientEmail || 'there';
  const partner = offer.partnerName || 'your team';
  const ctaText = offer.ctaLabel || 'review your private offer';
  const expires = formatLongDate(offer.expiresAt);
  const isTeamOffer = /team/i.test(offer.offerTitle);

  const emailSubject = `${partner} x FLYR: Exclusive Offer`;
  const emailBody = [
    `Hi ${recipient},`,
    '',
    `I created a private FLYR offer page for ${partner}.`,
    `This link is invite-only and not public: ${offer.shareUrl}`,
    '',
    `${offer.offerMessage || 'You can review the details and next steps on that page.'}`,
    `Offer expires: ${expires}`,
    '',
    `When ready, click "${ctaText}" on the page.`,
    '',
    '— Daniel',
  ].join('\n');

  const smsText = `Hey ${recipient} — here is your private FLYR offer link for ${partner}: ${offer.shareUrl} (expires ${expires}).`;

  const igDmText = `Hey ${recipient}! I made an invite-only FLYR offer page for ${partner}: ${offer.shareUrl} (expires ${expires}).`;

  const teamOfferEmailHtml = isTeamOffer
    ? [
        `<p>Hi ${recipient},</p>`,
        `<p>I created a private FLYR offer page for ${partner}. This link is invite-only and not public: <a href="${offer.shareUrl}" target="_blank" rel="noopener noreferrer">${offer.shareUrl}</a></p>`,
        `<p>${offer.offerMessage || 'You can review the details and next steps on that page.'}</p>`,
        `<p><strong>Offer expires:</strong> ${expires}</p>`,
        `<div style="margin-top:16px;margin-bottom:16px;">`,
        `<div style="position: relative; padding-bottom: calc(64.94708994708994% + 41px); height: 0; width: 100%;">`,
        `<iframe`,
        `  src="https://demo.arcade.software/nbvH4JKdrqCGt8a0O8pi?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true"`,
        `  title="FLYR: Team Prospecting Dashboard"`,
        `  frameborder="0"`,
        `  loading="lazy"`,
        `  allowfullscreen`,
        `  allow="clipboard-write"`,
        `  style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; color-scheme: light;"`,
        `></iframe>`,
        `</div>`,
        `</div>`,
        `<p>When ready, click "${ctaText}" on the page.</p>`,
        `<p>— Daniel</p>`,
      ].join('\n')
    : null;

  return { emailSubject, emailBody, smsText, igDmText, teamOfferEmailHtml };
}

export function PartnerOffersManager() {
  const [offers, setOffers] = useState<PartnerOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

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

  const activeCount = useMemo(
    () => offers.filter((offer) => offer.status === 'active').length,
    [offers]
  );

  const loadOffers = useCallback(async () => {
    setError(null);
    const response = await fetch('/api/admin/offers', { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load offers');
    }
    setOffers((payload as PartnerOffersPayload).offers ?? []);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadOffers()
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load offers'))
      .finally(() => setLoading(false));
  }, [loadOffers]);

  const handleCreateOffer = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSaving(true);
      setError(null);
      setCopySuccess(null);
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
          setOffers((prev) => [offer, ...prev]);
          setCopySuccess(offer.id);
          await navigator.clipboard.writeText(offer.shareUrl).catch(() => undefined);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create offer');
      } finally {
        setSaving(false);
      }
    },
    [ctaLabel, ctaUrl, expiresAt, maxViews, offerMessage, offerTitle, partnerName, recipientEmail, recipientName]
  );

  const copyLink = useCallback(async (offer: PartnerOffer) => {
    await navigator.clipboard.writeText(offer.shareUrl);
    setCopySuccess(offer.id);
    window.setTimeout(() => {
      setCopySuccess((current) => (current === offer.id ? null : current));
    }, 1800);
  }, []);

  const copyText = useCallback(async (value: string, offerId: string) => {
    await navigator.clipboard.writeText(value);
    setCopySuccess(offerId);
    window.setTimeout(() => {
      setCopySuccess((current) => (current === offerId ? null : current));
    }, 1800);
  }, []);

  const applyTemplate = useCallback((template: OfferTemplate) => {
    setSelectedTemplate(template.id);
    setOfferTitle(template.title);
    setOfferMessage(template.message);
    setCtaLabel(template.ctaLabel);
  }, []);

  const revokeOffer = useCallback(async (offerId: string) => {
    const confirmed = window.confirm('Revoke this link now? This cannot be undone.');
    if (!confirmed) return;
    setRevokingId(offerId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/offers/${offerId}/revoke`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to revoke offer');
      }
      setOffers((prev) =>
        prev.map((offer) =>
          offer.id === offerId ? { ...offer, revokedAt: new Date().toISOString(), status: 'revoked' } : offer
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke offer');
    } finally {
      setRevokingId(null);
    }
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Partner Offers</h1>
        <p className="text-muted-foreground">
          Create invite-only offer links for demos, partners, and prospects.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total offers</CardDescription>
            <CardTitle>{offers.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Active links</CardDescription>
            <CardTitle>{activeCount}</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle>Created offers</CardTitle>
          <CardDescription>Newest first. Revoke any link instantly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading offers...
            </div>
          ) : offers.length === 0 ? (
            <div className="text-sm text-muted-foreground">No offers yet.</div>
          ) : (
            offers.map((offer) => (
              <div key={offer.id} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-sm">{offer.offerTitle}</div>
                    <div className="text-xs text-muted-foreground">
                      {offer.partnerName}
                      {offer.recipientName ? ` • ${offer.recipientName}` : ''}
                      {offer.recipientEmail ? ` • ${offer.recipientEmail}` : ''}
                    </div>
                  </div>
                  <Badge variant={statusVariant(offer.status)}>{statusLabel(offer.status)}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Expires: {formatLongDate(offer.expiresAt)}
                  {offer.maxViews ? ` • ${offer.viewCount}/${offer.maxViews} views` : ` • ${offer.viewCount} views`}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input readOnly value={offer.shareUrl} className="h-8 text-xs" />
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => void copyLink(offer)}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    {copySuccess === offer.id ? 'Copied' : 'Copy'}
                  </Button>
                  {offer.status !== 'revoked' ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      type="button"
                      disabled={revokingId === offer.id}
                      onClick={() => void revokeOffer(offer.id)}
                    >
                      {revokingId === offer.id ? 'Revoking...' : 'Revoke'}
                    </Button>
                  ) : null}
                </div>
                <div className="rounded-md bg-muted/40 p-2 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Outreach copy</div>
                  {(() => {
                    const copy = buildOutreachCopy(offer);
                    return (
                      <div className="grid gap-2">
                        <div className="rounded border bg-background p-2">
                          <div className="text-[11px] text-muted-foreground mb-1">Email</div>
                          <div className="text-xs whitespace-pre-wrap">
                            Subject: {copy.emailSubject}
                            {'\n\n'}
                            {copy.emailBody}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() => void copyText(`Subject: ${copy.emailSubject}\n\n${copy.emailBody}`, offer.id)}
                            >
                              Copy email
                            </Button>
                            {copy.teamOfferEmailHtml ? (
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                onClick={() => void copyText(copy.teamOfferEmailHtml ?? '', offer.id)}
                              >
                                Copy team email HTML
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="rounded border bg-background p-2">
                          <div className="text-[11px] text-muted-foreground mb-1">Text message (SMS)</div>
                          <div className="text-xs whitespace-pre-wrap">{copy.smsText}</div>
                          <div className="mt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() => void copyText(copy.smsText, offer.id)}
                            >
                              Copy SMS
                            </Button>
                          </div>
                        </div>
                        <div className="rounded border bg-background p-2">
                          <div className="text-[11px] text-muted-foreground mb-1">Instagram DM</div>
                          <div className="text-xs whitespace-pre-wrap">{copy.igDmText}</div>
                          <div className="mt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() => void copyText(copy.igDmText, offer.id)}
                            >
                              Copy IG DM
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
