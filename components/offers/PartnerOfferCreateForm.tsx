'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, Copy, Link2, Mail, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  OFFER_TEMPLATES,
  buildOutreachCopy,
  expiresAtIsoFromDateInput,
  isJustListedDmOffer,
  slugifyPartnerOfferPath,
  toLocalDateInputValue,
  type OfferTemplate,
  type PartnerOffer,
} from '@/components/offers/partnerOfferUtils';
import { PartnerOfferEmailPreview } from '@/components/offers/PartnerOfferEmailPreview';
import { PartnerOfferDmPreview } from '@/components/offers/PartnerOfferDmPreview';
import {
  PARTNER_OFFER_EMAIL_BODY_HOOK,
  PARTNER_OFFER_EMAIL_SUBJECT_SENTINEL,
} from '@/lib/email/partnerOfferEmailCopy';
import { cn } from '@/lib/utils';

type OfferResponse = {
  offer?: PartnerOffer;
  error?: string;
};

const PARTNER_OFFER_FROM_LABEL = 'Daniel Phillippe <daniel@wolfgrid.app>';

function parseExpiryPickerValue(value: string): Date | null {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(t);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatExpiryChip(value: string): string {
  const date = parseExpiryPickerValue(value);
  if (!date) return 'soon';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function defaultFlyrPartnerExpiry(): string {
  const couponExpiry = new Date(2026, 11, 31);
  if (couponExpiry.getTime() > Date.now()) {
    return toLocalDateInputValue(couponExpiry);
  }
  return toLocalDateInputValue(new Date(Date.now() + 1000 * 60 * 60 * 24 * 14));
}

function buildRecipientLabel(name: string, email: string): string {
  if (name.trim() && email.trim()) return `${name.trim()} <${email.trim()}>`;
  return name.trim() || email.trim() || 'Recipient';
}

export function PartnerOfferCreateForm() {
  const [mobilePanel, setMobilePanel] = useState<'compose' | 'preview'>('compose');
  const [selectedTemplate, setSelectedTemplate] = useState<OfferTemplate['id'] | null>(null);
  const [partnerName, setPartnerName] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState(PARTNER_OFFER_EMAIL_SUBJECT_SENTINEL);
  const [messageBody, setMessageBody] = useState(PARTNER_OFFER_EMAIL_BODY_HOOK);
  const [ctaLabel, setCtaLabel] = useState('Book your team onboarding');
  const [vanitySlug, setVanitySlug] = useState('');
  const [maxViews, setMaxViews] = useState('');
  const [expiresAt, setExpiresAt] = useState(() =>
    toLocalDateInputValue(new Date(Date.now() + 1000 * 60 * 60 * 24 * 14))
  );
  const [draftOffer, setDraftOffer] = useState<PartnerOffer | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [syncState, setSyncState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [customLinkTouched, setCustomLinkTouched] = useState(false);
  const lastSyncedSnapshotRef = useRef<string | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildPayload = useCallback(
    (overrides?: Partial<Record<string, string | boolean | null>>) => ({
      recipientName,
      recipientEmail,
      partnerName,
      offerTitle: subject,
      offerMessage: messageBody,
      ctaLabel,
      vanitySlug,
      ctaUrl: '',
      maxViews,
      expiresAt: expiresAtIsoFromDateInput(expiresAt),
      draft: draftOffer?.isDraft ?? true,
      ...overrides,
    }),
    [ctaLabel, draftOffer?.isDraft, expiresAt, maxViews, messageBody, partnerName, recipientEmail, recipientName, subject, vanitySlug]
  );

  useEffect(() => {
    if (customLinkTouched) return;
    const seed = partnerName.trim() || subject.trim() || 'offer';
    setVanitySlug(slugifyPartnerOfferPath(seed));
  }, [customLinkTouched, partnerName, subject]);

  const createDraft = useCallback(
    async (template: OfferTemplate, templateExpiresAt?: string) => {
      const previousDraft = draftOffer;
      const nextPayload = buildPayload({
        offerTitle: template.title,
        offerMessage: template.message,
        ctaLabel: template.ctaLabel,
        ...(templateExpiresAt ? { expiresAt: expiresAtIsoFromDateInput(templateExpiresAt) } : {}),
        draft: true,
      });

      setComposerError(null);
      setStatusMessage(null);
      setIsGeneratingLink(true);

      try {
        const response = await fetch('/api/admin/offers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(nextPayload),
        });
        const payload = (await response.json().catch(() => ({}))) as OfferResponse;
        if (!response.ok || !payload.offer) {
          throw new Error(payload.error || 'Failed to generate invite link');
        }

        setDraftOffer(payload.offer);
        lastSyncedSnapshotRef.current = JSON.stringify({ ...nextPayload, draft: true });
        setStatusMessage('Invite link ready to copy.');

        if (previousDraft?.id && previousDraft.isDraft) {
          void fetch(`/api/admin/offers/${previousDraft.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ revoke: true, draft: true }),
          });
        }
      } catch (error) {
        setComposerError(error instanceof Error ? error.message : 'Failed to generate invite link');
        setDraftOffer(null);
      } finally {
        setIsGeneratingLink(false);
      }
    },
    [buildPayload, draftOffer]
  );

  const persistOffer = useCallback(
    async (markLive: boolean) => {
      const draftFlag = !markLive;
      const payload = buildPayload({ draft: draftFlag });
      let response: Response;

      if (draftOffer?.id) {
        response = await fetch(`/api/admin/offers/${draftOffer.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch('/api/admin/offers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      }

      const result = (await response.json().catch(() => ({}))) as OfferResponse;
      if (!response.ok || !result.offer) {
        throw new Error(result.error || 'Failed to save offer');
      }

      setDraftOffer(result.offer);
      lastSyncedSnapshotRef.current = JSON.stringify(payload);
      return result.offer;
    },
    [buildPayload, draftOffer?.id]
  );

  useEffect(() => {
    if (!draftOffer?.id || isGeneratingLink) return;
    const snapshot = JSON.stringify(buildPayload({ draft: draftOffer.isDraft }));
    if (snapshot === lastSyncedSnapshotRef.current) return;

    setSyncState('saving');
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      fetch(`/api/admin/offers/${draftOffer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: snapshot,
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as OfferResponse;
          if (!response.ok || !payload.offer) {
            throw new Error(payload.error || 'Failed to sync draft');
          }
          setDraftOffer(payload.offer);
          lastSyncedSnapshotRef.current = snapshot;
          setSyncState('saved');
          window.setTimeout(() => setSyncState('idle'), 1200);
        })
        .catch((error) => {
          setComposerError(error instanceof Error ? error.message : 'Failed to sync draft');
          setSyncState('idle');
        });
    }, 650);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [buildPayload, draftOffer?.id, draftOffer?.isDraft, isGeneratingLink]);

  const handleTemplateSelect = useCallback(
    async (template: OfferTemplate) => {
      setSelectedTemplate(template.id);
      setSubject(template.title);
      setMessageBody(template.message);
      setCtaLabel(template.ctaLabel);
      const templateExpiresAt =
        template.id === 'flyr-partner-free-forever' ? defaultFlyrPartnerExpiry() : undefined;
      if (template.id === 'flyr-partner-free-forever') {
        setExpiresAt(templateExpiresAt ?? expiresAt);
      }
      if (!customLinkTouched) {
        const seed = partnerName.trim() || template.title;
        setVanitySlug(slugifyPartnerOfferPath(seed));
      }
      await createDraft(template, templateExpiresAt);
    },
    [createDraft, customLinkTouched, expiresAt, partnerName]
  );

  const handleCopyLink = useCallback(async () => {
    if (!draftOffer?.shareUrl) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(draftOffer.shareUrl);
      toast.success('Invite link copied.');
    } catch {
      toast.error('Failed to copy invite link.');
    } finally {
      setCopying(false);
    }
  }, [draftOffer?.shareUrl]);

  const handleSaveDraft = useCallback(async () => {
    if (!selectedTemplate) {
      setComposerError('Select a template to generate an invite link first.');
      return;
    }

    setComposerError(null);
    setStatusMessage(null);
    setIsSavingDraft(true);
    try {
      await persistOffer(true);
      setStatusMessage('Draft saved.');
      window.dispatchEvent(new CustomEvent('flyr-offers-refresh'));
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'Failed to save draft');
    } finally {
      setIsSavingDraft(false);
    }
  }, [persistOffer, selectedTemplate]);

  const handleCreateOffer = useCallback(async () => {
    if (!selectedTemplate) {
      setComposerError('Select a template to generate an invite link first.');
      return;
    }

    setComposerError(null);
    setStatusMessage(null);
    setIsSavingDraft(true);
    try {
      await persistOffer(true);
      setStatusMessage('Offer created.');
      window.dispatchEvent(new CustomEvent('flyr-offers-refresh'));
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'Failed to create offer');
    } finally {
      setIsSavingDraft(false);
    }
  }, [persistOffer, selectedTemplate]);

  const handleSend = useCallback(async () => {
    if (!selectedTemplate) {
      setComposerError('Select a template to generate an invite link first.');
      return;
    }

    setComposerError(null);
    setStatusMessage(null);
    setIsSending(true);
    try {
      const offer = await persistOffer(true);
      const response = await fetch(`/api/admin/offers/${offer.id}/send-email`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = (await response.json().catch(() => ({}))) as {
        offer?: PartnerOffer;
        error?: string;
      };
      if (!response.ok || !payload.offer) {
        throw new Error(payload.error || 'Failed to send offer');
      }
      setDraftOffer(payload.offer);
      setStatusMessage(`Sent to ${recipientEmail.trim() || 'recipient'}.`);
      window.dispatchEvent(new CustomEvent('flyr-offers-refresh'));
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'Failed to send offer');
    } finally {
      setIsSending(false);
    }
  }, [persistOffer, recipientEmail, selectedTemplate]);

  const toLabel = useMemo(
    () => buildRecipientLabel(recipientName, recipientEmail),
    [recipientEmail, recipientName]
  );
  const inviteChipLabel = useMemo(
    () => `${isJustListedDmOffer(subject, messageBody) ? 'DM link' : 'Invite link'} · expires ${formatExpiryChip(expiresAt)}`,
    [expiresAt, messageBody, subject]
  );
  const isDmTemplate = selectedTemplate === 'just-listed-dm' || isJustListedDmOffer(subject, messageBody);
  const previewOffer = useMemo<PartnerOffer>(
    () => ({
      id: draftOffer?.id ?? 'preview',
      isDraft: true,
      recipientName: recipientName.trim() || null,
      recipientEmail: recipientEmail.trim() || null,
      partnerName: partnerName.trim() || 'your team',
      offerTitle: subject,
      offerMessage: messageBody,
      ctaLabel,
      ctaUrl: null,
      maxViews: null,
      viewCount: 0,
      expiresAt: expiresAtIsoFromDateInput(expiresAt),
      lastViewedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      emailSent: false,
      emailSentAt: null,
      emailRecipient: null,
      resendMessageId: null,
      emailStatus: 'not_requested',
      status: 'active',
      vanitySlug: vanitySlug || null,
      shareUrl: draftOffer?.shareUrl || `https://wolfgrid.app/${vanitySlug || 'companyname'}`,
    }),
    [ctaLabel, draftOffer?.id, draftOffer?.shareUrl, expiresAt, messageBody, partnerName, recipientEmail, recipientName, subject, vanitySlug]
  );
  const dmCopy = useMemo(() => buildOutreachCopy(previewOffer), [previewOffer]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-4 shrink-0 sm:hidden">
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-1">
          <Button
            type="button"
            variant={mobilePanel === 'compose' ? 'default' : 'ghost'}
            className={cn(
              'h-9',
              mobilePanel === 'compose' ? 'bg-foreground text-background hover:bg-foreground/90' : ''
            )}
            onClick={() => setMobilePanel('compose')}
          >
            Compose
          </Button>
          <Button
            type="button"
            variant={mobilePanel === 'preview' ? 'default' : 'ghost'}
            className={cn(
              'h-9',
              mobilePanel === 'preview' ? 'bg-foreground text-background hover:bg-foreground/90' : ''
            )}
            onClick={() => setMobilePanel('preview')}
          >
            Preview
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden sm:gap-6 xl:grid xl:min-h-[calc(100vh-9rem)] xl:grid-cols-2 xl:gap-6">
        <section
          className={cn(
            'min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background',
            mobilePanel === 'compose' ? 'flex flex-1' : 'hidden',
            'sm:flex sm:min-h-0 sm:flex-1'
          )}
        >
          <div className="shrink-0 border-b border-border px-4 py-4 sm:px-6 sm:py-5">
            <h2 className="text-xl font-semibold text-foreground">Compose</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isDmTemplate
                ? 'Draft the partner DM and keep the private link live while you work.'
                : 'Draft the partner email and keep the invite link live while you work.'}
            </p>
            <div className="mt-4 space-y-3 sm:mt-5">
              <Label>Template</Label>
              <div className="flex flex-wrap gap-2">
                {OFFER_TEMPLATES.map((template) => {
                  const active = selectedTemplate === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => void handleTemplateSelect(template)}
                      className={cn(
                        'inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors',
                        active
                          ? 'border-red-500 bg-red-500 text-white'
                          : 'border-border bg-background text-foreground hover:border-red-300 hover:text-red-600'
                      )}
                    >
                      {template.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6">
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label>To</Label>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                  <Input
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    placeholder="Sarah Lee"
                  />
                  <Input
                    type="email"
                    value={recipientEmail}
                    onChange={(event) => setRecipientEmail(event.target.value)}
                    placeholder="sarah@acme.com"
                  />
                </div>
              </div>

              {!isDmTemplate ? (
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input value={PARTNER_OFFER_FROM_LABEL} readOnly className="bg-muted/40 text-muted-foreground" />
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="companyName">Company</Label>
                  <Input
                    id="companyName"
                    value={partnerName}
                    onChange={(event) => setPartnerName(event.target.value)}
                    placeholder="Acme Realty Group"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vanitySlug">Custom link</Label>
                  <div className="flex min-w-0 items-center rounded-lg border border-input bg-background px-3">
                    <span className="shrink-0 text-xs text-muted-foreground">wolfgrid.app/</span>
                    <Input
                      id="vanitySlug"
                      value={vanitySlug}
                      onChange={(event) => {
                        setCustomLinkTouched(true);
                        setVanitySlug(slugifyPartnerOfferPath(event.target.value));
                      }}
                      placeholder="acme-realty-group"
                      className="min-w-0 border-0 px-2 shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">{isDmTemplate ? 'Headline' : 'Subject'}</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Private WolfGrid page (expands with Company when sent)"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="messageBody">Message</Label>
                <Textarea
                  id="messageBody"
                  value={messageBody}
                  onChange={(event) => setMessageBody(event.target.value)}
                  placeholder="Write the note your partner will receive."
                  rows={10}
                  className="min-h-[220px] resize-y sm:min-h-[280px]"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ctaLabel">CTA label</Label>
                  <Input
                    id="ctaLabel"
                    value={ctaLabel}
                    onChange={(event) => setCtaLabel(event.target.value)}
                    placeholder="Review your offer"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expiresAt">Expires</Label>
                  <Input
                    id="expiresAt"
                    type="date"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="maxViews">Max views</Label>
                  <Input
                    id="maxViews"
                    type="number"
                    min={1}
                    value={maxViews}
                    onChange={(event) => setMaxViews(event.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Private link</Label>
                  <div className="flex min-h-11 flex-col items-stretch gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:gap-2 sm:py-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Link2 className="h-4 w-4 text-muted-foreground" />
                        <span>{inviteChipLabel}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {draftOffer?.shareUrl || 'Choose a template to generate the private link.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full shrink-0 sm:w-auto"
                      disabled={!draftOffer?.shareUrl || copying}
                      onClick={() => void handleCopyLink()}
                    >
                      {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                      Copy
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-background px-4 py-4 sm:px-6 sm:py-5">
            <div className="mb-4 min-h-5">
              {composerError ? (
                <p className="text-sm text-destructive">{composerError}</p>
              ) : statusMessage ? (
                <p className="inline-flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {statusMessage}
                </p>
              ) : syncState === 'saving' ? (
                <p className="text-sm text-muted-foreground">Saving changes…</p>
              ) : syncState === 'saved' ? (
                <p className="text-sm text-muted-foreground">All changes saved.</p>
              ) : null}
            </div>

            <Button
              type="button"
              variant="outline"
              className="mb-3 w-full"
              disabled={isSavingDraft || isSending || isGeneratingLink}
              onClick={() => void handleSaveDraft()}
            >
              {isSavingDraft ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving draft…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save draft
                </>
              )}
            </Button>

            {isDmTemplate ? (
              <Button
                type="button"
                className="w-full bg-red-600 text-white hover:bg-red-700"
                disabled={isSavingDraft || isGeneratingLink || !draftOffer?.shareUrl}
                onClick={() => void handleCreateOffer()}
              >
                {isSavingDraft ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating offer…
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Create this offer
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                className="w-full bg-red-600 text-white hover:bg-red-700"
                disabled={isSending || isSavingDraft || isGeneratingLink}
                onClick={() => void handleSend()}
              >
                {isSending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending via Resend…
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send via Resend
                  </>
                )}
              </Button>
            )}
          </div>
        </section>

        <section
          className={cn(
            'min-h-0 flex-col overflow-hidden',
            mobilePanel === 'preview' ? 'flex flex-1' : 'hidden',
            'sm:flex sm:min-h-0 sm:flex-1'
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {isDmTemplate ? (
              <PartnerOfferDmPreview
                recipientName={recipientName}
                openerText={dmCopy.igDmIntroText}
                replyText={dmCopy.igDmReplyText}
                linkText={dmCopy.igDmLinkText}
                privateOfferLink={previewOffer.shareUrl}
              />
            ) : (
              <PartnerOfferEmailPreview
                fromLabel={PARTNER_OFFER_FROM_LABEL}
                toLabel={toLabel}
                subjectField={subject}
                companyName={partnerName}
                recipientName={recipientName}
                offerMessage={messageBody}
                privateOfferLink={previewOffer.shareUrl}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
