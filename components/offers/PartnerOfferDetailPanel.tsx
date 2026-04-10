'use client';

import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Loader2 } from 'lucide-react';
import {
  buildOutreachCopy,
  formatLongDate,
  statusLabel,
  statusVariant,
  type PartnerOffer,
} from '@/components/offers/partnerOfferUtils';

type PartnerOfferDetailPanelProps = {
  offer: PartnerOffer;
  onRevoked?: () => void;
};

export function PartnerOfferDetailPanel({ offer, onRevoked }: PartnerOfferDetailPanelProps) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copyLink = useCallback(async (o: PartnerOffer) => {
    await navigator.clipboard.writeText(o.shareUrl);
    setCopySuccess(o.id);
    window.setTimeout(() => {
      setCopySuccess((current) => (current === o.id ? null : current));
    }, 1800);
  }, []);

  const copyText = useCallback(async (value: string, offerId: string) => {
    await navigator.clipboard.writeText(value);
    setCopySuccess(offerId);
    window.setTimeout(() => {
      setCopySuccess((current) => (current === offerId ? null : current));
    }, 1800);
  }, []);

  const revokeOffer = useCallback(async () => {
    const confirmed = window.confirm('Revoke this link now? This cannot be undone.');
    if (!confirmed) return;
    setRevokingId(offer.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/offers/${offer.id}/revoke`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to revoke offer');
      }
      onRevoked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke offer');
    } finally {
      setRevokingId(null);
    }
  }, [offer.id, onRevoked]);

  const copy = buildOutreachCopy(offer);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-foreground">{offer.offerTitle}</div>
            <div className="text-sm text-muted-foreground mt-1">
              {offer.partnerName}
              {offer.recipientName ? ` • ${offer.recipientName}` : ''}
              {offer.recipientEmail ? ` • ${offer.recipientEmail}` : ''}
            </div>
          </div>
          <Badge variant={statusVariant(offer.status)}>{statusLabel(offer.status)}</Badge>
        </div>
        <div className="text-sm text-muted-foreground">
          Expires: {formatLongDate(offer.expiresAt)}
          {offer.maxViews
            ? ` • ${offer.viewCount}/${offer.maxViews} views`
            : ` • ${offer.viewCount} views`}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input readOnly value={offer.shareUrl} className="h-9 text-xs font-mono" />
          <Button size="sm" variant="outline" type="button" onClick={() => void copyLink(offer)}>
            <Copy className="h-3.5 w-3.5 mr-1" />
            {copySuccess === offer.id ? 'Copied' : 'Copy link'}
          </Button>
          {offer.status !== 'revoked' ? (
            <Button
              size="sm"
              variant="destructive"
              type="button"
              disabled={revokingId === offer.id}
              onClick={() => void revokeOffer()}
            >
              {revokingId === offer.id ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Revoking…
                </span>
              ) : (
                'Revoke'
              )}
            </Button>
          ) : null}
        </div>

        <div className="rounded-md bg-muted/40 p-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Outreach copy</div>
          <div className="grid gap-2">
            <div className="rounded border bg-background p-2">
              <div className="text-[11px] text-muted-foreground mb-1">Email</div>
              <div className="text-xs whitespace-pre-wrap">
                Subject: {copy.emailSubject}
                {'\n\n'}
                {copy.emailBody}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    void copyText(`Subject: ${copy.emailSubject}\n\n${copy.emailBody}`, offer.id)
                  }
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
                    Copy HTML email (with demo)
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
        </div>
      </div>
    </div>
  );
}
