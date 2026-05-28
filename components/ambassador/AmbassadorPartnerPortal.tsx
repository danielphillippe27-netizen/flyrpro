'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Copy,
  Download,
  ExternalLink,
  ImageIcon,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { createClient as createSupabaseBrowserClient } from '@/lib/supabase/client';

type DashboardPayload = {
  referralCode: string;
  shareLink: string;
  landingPageUrl: string;
  commissionRate: number;
  commissionDurationMonths: number | null;
  totalClicks: number;
  landingPageViews: number;
  signupCount: number;
  workspaceCount: number;
  paidActiveReferralCount: number;
  pendingCommissionCents: number;
  lifetimePaidCommissionCents: number;
  recentCommissionActivity: Array<{
    id: string;
    eventType: string;
    amountCents: number;
    status: string;
    createdAt: string;
  }>;
};

type LandingPagePayload = {
  slug: string;
  displayName: string | null;
  headline: string | null;
  introMessage: string | null;
  profileImageUrl: string | null;
  heroVideoUrl: string | null;
  audienceType: string | null;
  ctaText: string | null;
  offerText: string | null;
  isPublished: boolean;
  publicUrl: string;
};

type AmbassadorLink = {
  id: string;
  name: string;
  source: string;
  campaign: string;
  destination: 'onboarding' | 'landing_page';
  generatedUrl: string;
  clickCount: number;
  signupCount: number;
  paidCustomerCount: number;
  notes?: string | null;
  createdAt: string;
};

type LinkDraft = {
  name: string;
  source: string;
  campaign: string;
  notes: string;
};

const emptyLinkDraft: LinkDraft = {
  name: '',
  source: 'instagram',
  campaign: '',
  notes: '',
};

const FREE_TRIAL_BUTTON_TEXT = 'Start 14 day free trial';

const brandingBlocks = [
  {
    title: 'Quick Pitch',
    use: 'Use this when someone asks what FLYR is.',
    body:
      'FLYR is a field prospecting app built for real estate agents, roofers, solar reps, and door-to-door sales teams. It helps users map their territory, track doors, organize follow-up, and prove their prospecting activity.',
  },
  {
    title: 'Approved Talking Points',
    use: 'Use this in short videos or DMs.',
    body:
      'Track every door you hit\nSee your territory visually on a live map\nAvoid overlapping routes with your team\nOrganize conversations, leads, and follow-ups\nTurn door knocking into measurable activity\nBuilt for real-world prospecting, not just CRM notes',
  },
  {
    title: 'Feature Highlights',
    use: 'Use this for product walkthroughs.',
    body:
      'Map-based door tracking\nLive canvassing sessions\nDoor status updates\nProspecting history\nTeam visibility\nRoute accountability\nReferral and follow-up organization',
  },
  {
    title: 'Content Hooks',
    use: 'Use this for post openers.',
    body:
      'Most agents say they door knock. Very few actually track it.\nDoor knocking without tracking is just guessing.\nThis is how I organize a full prospecting session.\nIf your team prospects in the field, you need visibility.\nStop losing track of which doors you hit.\nThis app turns door knocking into a system.\nFor realtors who still believe in real conversations.',
  },
  {
    title: 'Caption Template 1',
    use: 'Use this for Instagram, LinkedIn, or Facebook.',
    body:
      'Door knocking is still one of the most underrated ways to build a local business, but only if you track it.\n\nThat is why I have been using FLYR.\n\nIt helps you map your territory, track every door, organize conversations, and actually see the work you are putting in.\n\nUse my link to check it out.',
  },
  {
    title: 'Caption Template 2',
    use: 'Use this for a short product endorsement.',
    body:
      'Most people quit prospecting because they cannot see progress.\n\nFLYR fixes that.\n\nYou can see your doors, your conversations, your follow-ups, and your territory all in one place.\n\nIf you are serious about field sales, this is worth checking out.',
  },
  {
    title: "Dos and Don'ts",
    use: 'Use this before publishing content.',
    body:
      'Do:\nShow the app in real prospecting situations\nTalk about organization, consistency, and accountability\nExplain how FLYR helps with door knocking and field sales\nUse your own honest experience\nUse your referral link or landing page\n\nDo not:\nPromise guaranteed leads or income\nClaim FLYR replaces legal, brokerage, or CRM compliance requirements\nMisrepresent pricing or commissions\nUse fake results\nMake unsupported claims about conversion rates',
  },
];

const logoAssets = [
  {
    name: 'Black logo PNG',
    src: '/brand/flyr-logo-black.png',
    previewClassName: 'bg-white',
  },
  {
    name: 'White logo PNG',
    src: '/brand/flyr-logo-white.png',
    previewClassName: 'bg-[#101317]',
  },
];

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString();
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function AmbassadorPartnerPortal() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [landingPage, setLandingPage] = useState<LandingPagePayload | null>(null);
  const [links, setLinks] = useState<AmbassadorLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [landingSaving, setLandingSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const [mediaUploading, setMediaUploading] = useState<'photo' | 'video' | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft>(emptyLinkDraft);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const landingDraft = useMemo(
    () => ({
      slug: landingPage?.slug ?? '',
      displayName: landingPage?.displayName ?? '',
      headline: landingPage?.headline ?? '',
      introMessage: landingPage?.introMessage ?? '',
      profileImageUrl: landingPage?.profileImageUrl ?? '',
      heroVideoUrl: landingPage?.heroVideoUrl ?? '',
      audienceType: landingPage?.audienceType ?? 'real_estate',
      ctaText: landingPage?.ctaText ?? FREE_TRIAL_BUTTON_TEXT,
      offerText: landingPage?.offerText ?? '',
      isPublished: landingPage?.isPublished ?? false,
    }),
    [landingPage]
  );
  const [landingForm, setLandingForm] = useState(landingDraft);
  const [settingsForm, setSettingsForm] = useState({
    username: '',
    displayName: '',
  });

  const loadAll = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const [dashboardRes, landingRes, linksRes] = await Promise.all([
        fetch('/api/ambassador/dashboard', { credentials: 'include' }),
        fetch('/api/ambassador/landing-page', { credentials: 'include' }),
        fetch('/api/ambassador/links', { credentials: 'include' }),
      ]);
      if (dashboardRes.status === 403) {
        setStatus('Ambassador access is not active for this account.');
        return;
      }
      if (dashboardRes.ok) setDashboard(await dashboardRes.json());
      if (landingRes.ok) {
        const landing = (await landingRes.json()) as LandingPagePayload;
        setLandingPage(landing);
        setLandingForm({
          slug: landing.slug ?? '',
          displayName: landing.displayName ?? '',
          headline: landing.headline ?? '',
          introMessage: landing.introMessage ?? '',
          profileImageUrl: landing.profileImageUrl ?? '',
          heroVideoUrl: landing.heroVideoUrl ?? '',
          audienceType: landing.audienceType ?? 'real_estate',
          ctaText: landing.ctaText ?? FREE_TRIAL_BUTTON_TEXT,
          offerText: landing.offerText ?? '',
          isPublished: landing.isPublished ?? false,
        });
        setSettingsForm({
          username: landing.slug ?? '',
          displayName: landing.displayName ?? '',
        });
      }
      if (linksRes.ok) {
        const payload = (await linksRes.json()) as { links: AmbassadorLink[] };
        setLinks(payload.links ?? []);
      }
    } catch {
      setStatus('Could not load your partner portal. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const saveLandingPage = async () => {
    setLandingSaving(true);
    setStatus(null);
    try {
      const response = await fetch('/api/ambassador/landing-page', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...landingForm,
          ctaText: FREE_TRIAL_BUTTON_TEXT,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? 'Could not save landing page settings.');
        return;
      }
      setLandingPage(payload);
      setLandingForm((current) => ({
        ...current,
        ...payload,
        ctaText: payload.ctaText ?? FREE_TRIAL_BUTTON_TEXT,
      }));
      setStatus('Landing page saved.');
    } finally {
      setLandingSaving(false);
    }
  };

  const uploadLandingMedia = async (kind: 'photo' | 'video', file: File | null | undefined) => {
    if (!file) return;

    setMediaUploading(kind);
    setStatus(null);
    try {
      const prepareResponse = await fetch('/api/ambassador/media', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          kind,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      const preparePayload = await prepareResponse.json().catch(() => ({}));
      if (!prepareResponse.ok) {
        setStatus(preparePayload.error ?? 'Could not prepare upload.');
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(preparePayload.bucket)
        .uploadToSignedUrl(preparePayload.path, preparePayload.token, file);

      if (uploadError) {
        setStatus(uploadError.message || 'Could not upload media.');
        return;
      }

      const completeResponse = await fetch('/api/ambassador/media', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          kind,
          path: preparePayload.path,
        }),
      });
      const completePayload = await completeResponse.json().catch(() => ({}));
      if (!completeResponse.ok) {
        setStatus(completePayload.error ?? 'Upload finished, but the landing page could not be updated.');
        return;
      }

      if (completePayload.landingPage) {
        setLandingPage(completePayload.landingPage);
        setLandingForm((current) => ({
          ...current,
          profileImageUrl: completePayload.landingPage.profileImageUrl ?? '',
          heroVideoUrl: completePayload.landingPage.heroVideoUrl ?? '',
        }));
      }

      setStatus(kind === 'photo' ? 'Photo uploaded.' : 'Video uploaded.');
    } finally {
      setMediaUploading(null);
      if (kind === 'photo' && photoInputRef.current) photoInputRef.current.value = '';
      if (kind === 'video' && videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  const clearLandingMedia = async (kind: 'photo' | 'video') => {
    const nextForm = {
      ...landingForm,
      profileImageUrl: kind === 'photo' ? '' : landingForm.profileImageUrl,
      heroVideoUrl: kind === 'video' ? '' : landingForm.heroVideoUrl,
    };
    setLandingForm(nextForm);
    setLandingSaving(true);
    setStatus(null);
    try {
      const response = await fetch('/api/ambassador/landing-page', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...nextForm,
          ctaText: FREE_TRIAL_BUTTON_TEXT,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? 'Could not remove media.');
        return;
      }
      setLandingPage(payload);
      setStatus(kind === 'photo' ? 'Photo removed.' : 'Video removed.');
    } finally {
      setLandingSaving(false);
    }
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    setStatus(null);
    try {
      const response = await fetch('/api/ambassador/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? 'Could not save settings.');
        return;
      }
      setLandingPage((current) =>
        current
          ? {
              ...current,
              slug: payload.username ?? current.slug,
              displayName: payload.displayName ?? current.displayName,
              publicUrl: payload.publicUrl ?? current.publicUrl,
            }
          : current
      );
      setLandingForm((current) => ({
        ...current,
        slug: payload.username ?? current.slug,
        displayName: payload.displayName ?? current.displayName,
      }));
      setSettingsForm({
        username: payload.username ?? settingsForm.username,
        displayName: payload.displayName ?? settingsForm.displayName,
      });
      await loadAll();
      setStatus('Settings saved.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const submitLink = async () => {
    setLinkSaving(true);
    setStatus(null);
    try {
      const method = editingLinkId ? 'PATCH' : 'POST';
      const url = editingLinkId ? `/api/ambassador/links/${editingLinkId}` : '/api/ambassador/links';
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(linkDraft),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? 'Could not save link.');
        return;
      }
      setLinkDraft(emptyLinkDraft);
      setEditingLinkId(null);
      await loadAll();
      setStatus(editingLinkId ? 'Link updated.' : 'Link created.');
    } finally {
      setLinkSaving(false);
    }
  };

  const deleteLink = async (id: string) => {
    const response = await fetch(`/api/ambassador/links/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (response.ok) {
      setLinks((current) => current.filter((link) => link.id !== id));
      setStatus('Link deleted.');
    }
  };

  const editLink = (link: AmbassadorLink) => {
    setEditingLinkId(link.id);
    setLinkDraft({
      name: link.name,
      source: link.source,
      campaign: link.campaign,
      notes: link.notes ?? '',
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">Partner Portal</h1>
            <Badge>AMBASSADOR</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Track referrals, manage your offer page, build campaign links, and copy approved content.
          </p>
        </div>
        {dashboard ? (
          <div className="text-sm text-muted-foreground">
            {dashboard.commissionRate}% for {dashboard.commissionDurationMonths ?? 12} months
          </div>
        ) : null}
      </div>

      {status ? <div className="rounded-md border bg-background p-3 text-sm">{status}</div> : null}

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:w-fit md:grid-cols-5">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="landing">Landing Page</TabsTrigger>
          <TabsTrigger value="links">Link Builder</TabsTrigger>
          <TabsTrigger value="kit">Branding Kit</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ['Clicks', dashboard?.totalClicks ?? 0],
              ['Page Views', dashboard?.landingPageViews ?? 0],
              ['Signups', dashboard?.signupCount ?? 0],
              ['Paid Customers', dashboard?.paidActiveReferralCount ?? 0],
              ['Pending', formatCurrency(dashboard?.pendingCommissionCents ?? 0)],
              ['Lifetime Paid', formatCurrency(dashboard?.lifetimePaidCommissionCents ?? 0)],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-2xl">{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Share Links</CardTitle>
                <CardDescription>Copy these when promoting FLYR.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ['Main link', dashboard?.shareLink ?? ''],
                  ['Referral code', dashboard?.referralCode ?? ''],
                  ['Landing page', dashboard?.landingPageUrl ?? ''],
                ].map(([label, value]) => (
                  <div key={label} className="grid gap-2 md:grid-cols-[8rem_1fr_auto] md:items-center">
                    <Label>{label}</Label>
                    <Input value={value} readOnly />
                    <Button variant="outline" size="sm" onClick={() => copyText(value)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Funnel</CardTitle>
                <CardDescription>Clicks -&gt; Signups -&gt; Paid -&gt; Commission</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2 text-center text-sm">
                  {[
                    dashboard?.totalClicks ?? 0,
                    dashboard?.signupCount ?? 0,
                    dashboard?.paidActiveReferralCount ?? 0,
                    formatCurrency(dashboard?.pendingCommissionCents ?? 0),
                  ].map((value, index) => (
                    <div key={index} className="rounded-md border bg-muted/30 p-3 font-semibold">
                      {value}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Commission Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard?.recentCommissionActivity.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.recentCommissionActivity.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>{event.eventType}</TableCell>
                        <TableCell>{event.status}</TableCell>
                        <TableCell>{formatCurrency(event.amountCents)}</TableCell>
                        <TableCell>{formatDate(event.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No commission activity yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="landing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Custom Landing Page</CardTitle>
              <CardDescription>Control your public partner offer page.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                <div className="space-y-2">
                  <Label>Public URL</Label>
                  <Input value={landingPage?.publicUrl ?? ''} readOnly />
                </div>
                <Button variant="outline" onClick={() => copyText(landingPage?.publicUrl ?? '')}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy URL
                </Button>
                <Button variant="outline" asChild>
                  <a href={landingPage?.publicUrl ?? '#'} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Preview
                  </a>
                </Button>
              </div>

              <div className="grid gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>Headline</Label>
                  <Input value={landingForm.headline} onChange={(event) => setLandingForm({ ...landingForm, headline: event.target.value })} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Subline</Label>
                  <Textarea value={landingForm.introMessage} onChange={(event) => setLandingForm({ ...landingForm, introMessage: event.target.value })} />
                </div>
                <div className="space-y-3 md:col-span-2">
                  <Label>Photo or video</Label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          Photo
                        </div>
                        <div className="flex gap-2">
                          {landingForm.profileImageUrl ? (
                            <Button variant="outline" size="sm" onClick={() => clearLandingMedia('photo')}>
                              <X className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => photoInputRef.current?.click()}
                            disabled={mediaUploading !== null}
                          >
                            {mediaUploading === 'photo' ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="mr-2 h-4 w-4" />
                            )}
                            Upload
                          </Button>
                        </div>
                      </div>
                      {landingForm.profileImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={landingForm.profileImageUrl}
                          alt="Landing page photo preview"
                          className="mt-3 aspect-video w-full rounded-md border object-cover"
                        />
                      ) : (
                        <div className="mt-3 flex aspect-video items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                          No photo uploaded
                        </div>
                      )}
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          uploadLandingMedia('photo', event.target.files?.[0])
                        }
                      />
                    </div>

                    <div className="rounded-md border bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Video className="h-4 w-4 text-muted-foreground" />
                          Video
                        </div>
                        <div className="flex gap-2">
                          {landingForm.heroVideoUrl ? (
                            <Button variant="outline" size="sm" onClick={() => clearLandingMedia('video')}>
                              <X className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => videoInputRef.current?.click()}
                            disabled={mediaUploading !== null}
                          >
                            {mediaUploading === 'video' ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="mr-2 h-4 w-4" />
                            )}
                            Upload
                          </Button>
                        </div>
                      </div>
                      {landingForm.heroVideoUrl ? (
                        <video
                          src={landingForm.heroVideoUrl}
                          className="mt-3 aspect-video w-full rounded-md border object-cover"
                          controls
                          playsInline
                        />
                      ) : (
                        <div className="mt-3 flex aspect-video items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                          No video uploaded
                        </div>
                      )}
                      <input
                        ref={videoInputRef}
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        className="hidden"
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          uploadLandingMedia('video', event.target.files?.[0])
                        }
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>CTA</Label>
                  <Textarea value={landingForm.offerText} onChange={(event) => setLandingForm({ ...landingForm, offerText: event.target.value })} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  variant={landingForm.isPublished ? 'default' : 'outline'}
                  onClick={() => setLandingForm({ ...landingForm, isPublished: !landingForm.isPublished })}
                >
                  {landingForm.isPublished ? 'Published' : 'Unpublished'}
                </Button>
                <Button onClick={saveLandingPage} disabled={landingSaving}>
                  {landingSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="links" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{editingLinkId ? 'Edit Link' : 'Create Link'}</CardTitle>
              <CardDescription>Create tracked links for each platform or content campaign.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={linkDraft.name} onChange={(event) => setLinkDraft({ ...linkDraft, name: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Source</Label>
                <Input value={linkDraft.source} onChange={(event) => setLinkDraft({ ...linkDraft, source: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Campaign</Label>
                <Input value={linkDraft.campaign} onChange={(event) => setLinkDraft({ ...linkDraft, campaign: event.target.value })} />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={submitLink} disabled={linkSaving}>
                  {linkSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  {editingLinkId ? 'Save Link' : 'Create'}
                </Button>
              </div>
              <div className="space-y-2 md:col-span-4">
                <Label>Notes</Label>
                <Textarea value={linkDraft.notes} onChange={(event) => setLinkDraft({ ...linkDraft, notes: event.target.value })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tracked Links</CardTitle>
            </CardHeader>
            <CardContent>
              {links.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Clicks</TableHead>
                      <TableHead>Signups</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {links.map((link) => (
                      <TableRow key={link.id}>
                        <TableCell>{link.name}</TableCell>
                        <TableCell>{link.source}</TableCell>
                        <TableCell>{link.campaign}</TableCell>
                        <TableCell>{link.clickCount}</TableCell>
                        <TableCell>{link.signupCount}</TableCell>
                        <TableCell>{link.paidCustomerCount}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => copyText(link.generatedUrl)}>
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => editLink(link)}>
                              Edit
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => deleteLink(link.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Create your first tracked link for Instagram, TikTok, YouTube, email, or DMs.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Branding Kit</CardTitle>
              <CardDescription>
                Use these approved assets and talking points when creating content for FLYR. Keep your content honest,
                practical, and based on your real experience.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {logoAssets.map((asset) => (
                  <div key={asset.name} className="rounded-lg border bg-muted/30 p-4">
                    <div className={`flex aspect-[3/1] items-center justify-center rounded-md p-6 ${asset.previewClassName}`}>
                      <Image
                        src={asset.src}
                        alt={asset.name}
                        width={1200}
                        height={568}
                        className="h-full max-h-20 w-full object-contain"
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{asset.name}</span>
                      <Button variant="outline" size="sm" asChild>
                        <a href={asset.src} download>
                          <Download className="h-4 w-4" />
                          PNG
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            {brandingBlocks.map((block) => (
              <Card key={block.title}>
                <CardHeader>
                  <CardTitle className="text-lg">{block.title}</CardTitle>
                  <CardDescription>{block.use}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-sm leading-6">
                    {block.body}
                  </pre>
                  <Button variant="outline" size="sm" onClick={() => copyText(block.body)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Partner Settings</CardTitle>
              <CardDescription>Control the public username and display name for your ambassador page.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input
                    value={settingsForm.username}
                    onChange={(event) => setSettingsForm({ ...settingsForm, username: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Display name</Label>
                  <Input
                    value={settingsForm.displayName}
                    onChange={(event) => setSettingsForm({ ...settingsForm, displayName: event.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-2">
                  <Label>Public URL</Label>
                  <Input value={landingPage?.publicUrl ?? ''} readOnly />
                </div>
                <Button variant="outline" onClick={() => copyText(landingPage?.publicUrl ?? '')}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy URL
                </Button>
              </div>

              <div className="flex justify-end">
                <Button onClick={saveSettings} disabled={settingsSaving}>
                  {settingsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
