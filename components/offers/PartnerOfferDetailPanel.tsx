'use client';

import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Copy, Loader2, QrCode } from 'lucide-react';
import {
  buildOutreachCopy,
  emailStatusLabel,
  formatLongDate,
  isJustListedDmOffer,
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
  const [sendingEmail, setSendingEmail] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerQrBase64, setOfferQrBase64] = useState<string | null>(null);
  const [offerQrTargetUrl, setOfferQrTargetUrl] = useState<string | null>(null);
  const [offerQrLoading, setOfferQrLoading] = useState(false);

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

  const generateOfferQr = useCallback(async () => {
    setOfferQrLoading(true);
    setError(null);
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
      const res = await fetch(`/api/admin/offers/${offer.id}/qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ baseUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      const qrBase64 = data.qrBase64 as string | undefined;
      const targetUrl = data.targetUrl as string | undefined;
      if (qrBase64) {
        setOfferQrBase64(qrBase64);
        setOfferQrTargetUrl(typeof targetUrl === 'string' ? targetUrl : null);
        const link = document.createElement('a');
        link.href = qrBase64;
        const slug =
          offer.vanitySlug?.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) ||
          offer.id.slice(0, 8);
        link.download = `flyr-offer-${slug}-qr.png`;
        link.click();
      } else {
        setOfferQrBase64(null);
        setOfferQrTargetUrl(null);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to generate QR code';
      setError(message);
      toast.error(message);
    } finally {
      setOfferQrLoading(false);
    }
  }, [offer.id, offer.vanitySlug]);

  const downloadOfferQr = useCallback(() => {
    if (!offerQrBase64) return;
    const link = document.createElement('a');
    link.href = offerQrBase64;
    const slug =
      offer.vanitySlug?.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) ||
      offer.id.slice(0, 8);
    link.download = `flyr-offer-${slug}-qr.png`;
    link.click();
  }, [offer.id, offer.vanitySlug, offerQrBase64]);

  const resendOfferEmail = useCallback(async () => {
    setSendingEmail(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/offers/${offer.id}/send-email`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to resend offer email');
      }

      onRevoked?.();

      if (payload.emailSent) {
        toast.success(`Offer email sent to ${offer.recipientEmail ?? 'the recipient'}.`);
      } else {
        const message =
          typeof payload.emailError === 'string'
            ? payload.emailError
            : 'Offer email failed, but the private offer is still available.';
        setError(message);
        toast.error(message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to resend offer email';
      setError(message);
      toast.error(message);
    } finally {
      setSendingEmail(false);
    }
  }, [offer.id, offer.recipientEmail, onRevoked]);

  const copy = buildOutreachCopy(offer);
  const isDmTemplate = isJustListedDmOffer(offer.offerTitle, offer.offerMessage);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
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
        {!isDmTemplate ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-medium text-muted-foreground">Email delivery</div>
              <Badge
                variant={
                  offer.emailStatus === 'sent'
                    ? 'default'
                    : offer.emailStatus === 'failed'
                      ? 'destructive'
                      : 'outline'
                }
              >
                {emailStatusLabel(offer.emailStatus)}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {offer.emailStatus === 'sent'
                ? `Sent to ${offer.emailRecipient ?? offer.recipientEmail ?? 'the recipient'}${offer.emailSentAt ? ` on ${formatLongDate(offer.emailSentAt)}` : ''}.`
                : offer.emailStatus === 'failed'
                  ? `Last attempt for ${offer.emailRecipient ?? offer.recipientEmail ?? 'this recipient'} did not go through.`
                  : 'No email has been sent for this offer yet.'}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={sendingEmail || !offer.recipientEmail}
                onClick={() => void resendOfferEmail()}
              >
                {sendingEmail ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Sending…
                  </span>
                ) : (
                  'Resend offer email'
                )}
              </Button>
              {!offer.recipientEmail ? (
                <span className="text-xs text-muted-foreground self-center">
                  Add a recipient email to send this offer.
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Input readOnly value={offer.shareUrl} className="h-9 text-xs font-mono sm:flex-1" />
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

        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-muted-foreground">QR code</div>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-md">
                Same PNG settings as campaign “basic” QRs (512px). Encodes your public offer link for print or slides.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={offerQrLoading || offer.status !== 'active'}
                onClick={() => void generateOfferQr()}
              >
                {offerQrLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Generating…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <QrCode className="h-3.5 w-3.5" />
                    {offerQrBase64 ? 'Regenerate & download' : 'Generate QR'}
                  </span>
                )}
              </Button>
              {offerQrBase64 ? (
                <Button size="sm" variant="outline" type="button" onClick={downloadOfferQr}>
                  Download PNG
                </Button>
              ) : null}
            </div>
          </div>
          {offerQrBase64 ? (
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL from server */}
              <img
                src={offerQrBase64}
                alt={offerQrTargetUrl ? `QR code for ${offerQrTargetUrl}` : 'Offer link QR code'}
                className="w-40 h-40 rounded border bg-white p-2 object-contain"
              />
              {offerQrTargetUrl ? (
                <p className="text-[11px] text-muted-foreground font-mono break-all max-w-md pt-1">
                  {offerQrTargetUrl}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-md bg-muted/40 p-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Outreach copy</div>
          <div className="grid gap-2">
            {!isDmTemplate ? (
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
            ) : null}
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
              <div className="text-[11px] text-muted-foreground mb-1">
                {isDmTemplate ? 'Instagram DM opener' : 'Instagram DM'}
              </div>
              <div className="text-xs whitespace-pre-wrap">
                {isDmTemplate ? copy.igDmIntroText : copy.igDmText}
              </div>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void copyText(isDmTemplate ? copy.igDmIntroText : copy.igDmText, offer.id)}
                >
                  {isDmTemplate ? 'Copy opener' : 'Copy IG DM'}
                </Button>
              </div>
            </div>
            {isDmTemplate ? (
              <div className="rounded border bg-background p-2">
                <div className="text-[11px] text-muted-foreground mb-1">Instagram DM reply</div>
                <div className="text-xs whitespace-pre-wrap">{copy.igDmReplyText}</div>
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => void copyText(copy.igDmReplyText, offer.id)}
                  >
                    Copy reply
                  </Button>
                </div>
              </div>
            ) : null}
            {isDmTemplate ? (
              <div className="rounded border bg-background p-2">
                <div className="text-[11px] text-muted-foreground mb-1">Instagram DM with link</div>
                <div className="text-xs whitespace-pre-wrap">
                  {copy.igDmLinkText}
                  {'\n\n'}
                  {offer.shareUrl}
                </div>
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => void copyText(`${copy.igDmLinkText}\n\n${offer.shareUrl}`, offer.id)}
                  >
                    Copy link message
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
