'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Copy,
  Download,
  Loader2,
  Save,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspace } from '@/lib/workspace-context';

type DashboardPayload = {
  referralCode: string;
  shareLink: string;
  landingPageUrl: string;
  reTeamLink: string;
  commissionRate: number;
  commissionDurationMonths: number | null;
  totalClicks: number;
  landingPageViews: number;
  reTeamLandingPageViews: number;
  reTeamClicks: number;
  reTeamSignupCount: number;
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
  const router = useRouter();
  const { accessLevel, isAmbassador } = useWorkspace();
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [landingPage, setLandingPage] = useState<LandingPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    username: '',
    displayName: '',
  });

  const loadAll = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const [dashboardRes, landingRes] = await Promise.all([
        fetch('/api/ambassador/dashboard', { credentials: 'include' }),
        fetch('/api/ambassador/landing-page', { credentials: 'include' }),
      ]);
      if (dashboardRes.status === 403) {
        setStatus('Ambassador access is not active for this account.');
        return;
      }
      if (dashboardRes.ok) setDashboard(await dashboardRes.json());
      if (landingRes.ok) {
        const landing = (await landingRes.json()) as LandingPagePayload;
        setLandingPage(landing);
        setSettingsForm({
          username: landing.slug ?? '',
          displayName: landing.displayName ?? '',
        });
      }
    } catch {
      setStatus('Could not load your partner portal. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessLevel === 'salesperson' && !isAmbassador) {
      router.replace('/home');
      return;
    }

    void loadAll();
  }, [accessLevel, isAmbassador, router]);

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
            Track referrals and copy approved content.
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
        <TabsList className="grid w-full grid-cols-3 md:w-fit">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
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
                  ['RE Team link', dashboard?.reTeamLink ?? ''],
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
              <CardContent className="space-y-4">
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
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-3 text-sm font-medium">RE Team link</div>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    {[
                      ['Views', dashboard?.reTeamLandingPageViews ?? 0],
                      ['Clicks', dashboard?.reTeamClicks ?? 0],
                      ['Signups', dashboard?.reTeamSignupCount ?? 0],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md border bg-background p-2">
                        <div className="font-semibold">{value}</div>
                        <div className="text-xs text-muted-foreground">{label}</div>
                      </div>
                    ))}
                  </div>
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
