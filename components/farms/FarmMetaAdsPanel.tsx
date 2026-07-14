'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Eye, Link2, Plug, RefreshCw, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type FarmMetaAdsPanelProps = {
  farmId: string;
  workspaceId?: string | null;
};

type MetaConnectionStatus = {
  connected: boolean;
  id?: string;
  meta_user_id?: string | null;
  token_expires_at?: string | null;
  scopes?: string[];
  connected_at?: string | null;
};

type MetaAdAccount = {
  meta_ad_account_id: string;
  name?: string | null;
  currency?: string | null;
  account_status?: string | null;
};

type MetaCampaign = {
  id: string;
  name: string;
  status?: string | null;
  objective?: string | null;
  start_time?: string | null;
  stop_time?: string | null;
};

type MetaMetricsSummary = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  last_synced_date: string | null;
};

type FarmMetaCampaignLink = {
  id: string;
  meta_ad_account_id: string;
  meta_campaign_id: string;
  meta_campaign_name?: string | null;
  status?: string | null;
  linked_at?: string | null;
  last_synced_at?: string | null;
  metrics_summary: MetaMetricsSummary;
};

type MetaAdMetricsSummary = Omit<MetaMetricsSummary, 'last_synced_date'>;

type MetaAd = {
  id: string;
  name: string;
  status?: string | null;
  effective_status?: string | null;
  creative?: {
    id?: string | null;
    name?: string | null;
    thumbnail_url?: string | null;
  };
  metrics: MetaAdMetricsSummary;
};

type MetaAdsPayload = {
  ads?: MetaAd[];
  summary?: MetaAdMetricsSummary;
  window?: {
    since: string;
    until: string;
  };
};

function formatInteger(value: number): string {
  return Math.max(0, Number(value || 0)).toLocaleString();
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  }).format(Number(value || 0));
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not synced yet';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not synced yet';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isExpired(connection: MetaConnectionStatus | null): boolean {
  if (!connection?.token_expires_at) return false;
  return new Date(connection.token_expires_at).getTime() <= Date.now();
}

export function FarmMetaAdsPanel({ farmId, workspaceId }: FarmMetaAdsPanelProps) {
  const [connection, setConnection] = useState<MetaConnectionStatus | null>(null);
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([]);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [links, setLinks] = useState<FarmMetaCampaignLink[]>([]);
  const [adsByCampaignId, setAdsByCampaignId] = useState<Record<string, MetaAd[]>>({});
  const [loadingAdsByCampaignId, setLoadingAdsByCampaignId] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<MetaMetricsSummary>({
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leads: 0,
    last_synced_date: null,
  });
  const [selectedAdAccountId, setSelectedAdAccountId] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callbackNotice, setCallbackNotice] = useState<string | null>(null);

  const currency = useMemo(() => {
    const selected = adAccounts.find((account) => account.meta_ad_account_id === selectedAdAccountId);
    return selected?.currency || adAccounts[0]?.currency || 'CAD';
  }, [adAccounts, selectedAdAccountId]);

  const totalCostPerLead = summary.leads > 0 ? summary.spend / summary.leads : null;

  const loadLinks = useCallback(async () => {
    const response = await fetch(`/api/farms/${farmId}/meta-campaign-links`, { credentials: 'include' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'Failed to load linked Meta campaigns.');
    setLinks(payload.links ?? []);
    setSummary(payload.summary ?? {
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      leads: 0,
      last_synced_date: null,
    });
  }, [farmId]);

  const loadConnection = useCallback(async () => {
    const response = await fetch('/api/meta/connection', { credentials: 'include' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'Failed to load Meta connection.');
    setConnection(payload);
    return payload as MetaConnectionStatus;
  }, []);

  const loadAdAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setError(null);
    try {
      const response = await fetch('/api/meta/ad-accounts', { credentials: 'include' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'No ad accounts found.');
      const accounts = (payload.ad_accounts ?? []) as MetaAdAccount[];
      setAdAccounts(accounts);
      if (!selectedAdAccountId && accounts[0]?.meta_ad_account_id) {
        setSelectedAdAccountId(accounts[0].meta_ad_account_id);
      }
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : 'No ad accounts found.');
    } finally {
      setLoadingAccounts(false);
    }
  }, [selectedAdAccountId]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextConnection = await loadConnection();
      await loadLinks();
      if (nextConnection.connected) {
        setCallbackNotice((notice) =>
          notice === 'Meta returned successfully, but no connection was saved. Try connecting Meta Ads again.'
            ? null
            : notice
        );
        await loadAdAccounts();
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Meta Ads.');
    } finally {
      setLoading(false);
    }
  }, [loadAdAccounts, loadConnection, loadLinks]);

  const loadCampaigns = useCallback(async (adAccountId: string) => {
    if (!adAccountId) return;
    setLoadingCampaigns(true);
    setError(null);
    try {
      const response = await fetch(`/api/meta/campaigns?adAccountId=${encodeURIComponent(adAccountId)}`, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Campaign fetch failed.');
      const nextCampaigns = (payload.campaigns ?? []) as MetaCampaign[];
      setCampaigns(nextCampaigns);
      setSelectedCampaignId(nextCampaigns[0]?.id ?? '');
    } catch (campaignError) {
      setCampaigns([]);
      setSelectedCampaignId('');
      setError(campaignError instanceof Error ? campaignError.message : 'Campaign fetch failed.');
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const metaStatus = params.get('meta');
    const message = params.get('message');

    if (metaStatus === 'connected') {
      setCallbackNotice('Meta Ads connected. Loading your ad accounts...');
    } else if (metaStatus === 'error') {
      setCallbackNotice(message || 'Meta Ads connection failed.');
    }

    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (loading || connection?.connected) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('meta') === 'connected') {
      setCallbackNotice('Meta returned successfully, but no connection was saved. Try connecting Meta Ads again.');
    }
  }, [connection?.connected, loading]);

  useEffect(() => {
    if (selectedAdAccountId) {
      void loadCampaigns(selectedAdAccountId);
    }
  }, [loadCampaigns, selectedAdAccountId]);

  const handleConnect = () => {
    const params = new URLSearchParams({ farmId });
    if (workspaceId) params.set('workspaceId', workspaceId);
    window.location.href = `/api/meta/oauth/start?${params.toString()}`;
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Meta Ads from WolfGrid? Historical farm metrics will remain.')) return;
    setError(null);
    try {
      const response = await fetch('/api/meta/disconnect', {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to disconnect Meta Ads.');
      setAdAccounts([]);
      setCampaigns([]);
      setAdsByCampaignId({});
      setSelectedAdAccountId('');
      setSelectedCampaignId('');
      await loadInitial();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect Meta Ads.');
    }
  };

  const handleLinkCampaign = async () => {
    const campaign = campaigns.find((candidate) => candidate.id === selectedCampaignId);
    if (!selectedAdAccountId || !campaign) return;
    setLinking(true);
    setError(null);
    try {
      const response = await fetch(`/api/farms/${farmId}/meta-campaign-links`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta_ad_account_id: selectedAdAccountId,
          meta_campaign_id: campaign.id,
          meta_campaign_name: campaign.name,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to link Meta campaign.');
      await loadLinks();
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'Failed to link Meta campaign.');
    } finally {
      setLinking(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch(`/api/farms/${farmId}/meta-sync`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Sync failed.');
      await loadLinks();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleUnlink = async (linkId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/farms/${farmId}/meta-campaign-links/${linkId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to unlink Meta campaign.');
      await loadLinks();
    } catch (unlinkError) {
      setError(unlinkError instanceof Error ? unlinkError.message : 'Failed to unlink Meta campaign.');
    }
  };

  const handleLoadAds = async (campaignId: string) => {
    setLoadingAdsByCampaignId((current) => ({ ...current, [campaignId]: true }));
    setError(null);
    try {
      const response = await fetch(`/api/meta/ads?campaignId=${encodeURIComponent(campaignId)}`, {
        credentials: 'include',
      });
      const payload = (await response.json().catch(() => null)) as MetaAdsPayload | { error?: string } | null;
      if (!response.ok) {
        throw new Error((payload as { error?: string } | null)?.error || 'Failed to load Meta ads.');
      }
      setAdsByCampaignId((current) => ({
        ...current,
        [campaignId]: ((payload as MetaAdsPayload)?.ads ?? []) as MetaAd[],
      }));
    } catch (adsError) {
      setError(adsError instanceof Error ? adsError.message : 'Failed to load Meta ads.');
    } finally {
      setLoadingAdsByCampaignId((current) => ({ ...current, [campaignId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Loading Meta Ads...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Meta spend</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatCurrency(summary.spend, currency)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total reach</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatInteger(summary.reach)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total impressions</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatInteger(summary.impressions)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total clicks</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatInteger(summary.clicks)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total leads</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatInteger(summary.leads)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Cost per lead</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {totalCostPerLead == null ? '-' : formatCurrency(totalCostPerLead, currency)}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4" />
            {connection?.connected ? 'Meta Ads Connected' : 'Connect Meta Ads'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!connection?.connected ? (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="max-w-2xl text-sm text-muted-foreground">
                Connect Facebook and Instagram ad analytics to track campaign performance inside this farm.
              </p>
              <Button onClick={handleConnect}>
                <Plug className="mr-2 h-4 w-4" />
                Connect Meta Ads
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={isExpired(connection) ? 'destructive' : 'secondary'}>
                      {isExpired(connection) ? 'Reconnect required' : 'Connected'}
                    </Badge>
                    {connection.meta_user_id ? (
                      <span className="text-xs text-muted-foreground">Meta user {connection.meta_user_id}</span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Meta ad results are imported from your connected ad account. WolfGrid does not create or edit ads yet.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void loadAdAccounts()} disabled={loadingAccounts}>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    {loadingAccounts ? 'Loading...' : 'Select Ad Account'}
                  </Button>
                  <Button variant="outline" onClick={() => void handleDisconnect()}>
                    <Unplug className="mr-2 h-4 w-4" />
                    Disconnect
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label>Ad account</Label>
                  <Select value={selectedAdAccountId} onValueChange={setSelectedAdAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder={adAccounts.length === 0 ? 'No ad accounts found' : 'Select ad account'} />
                    </SelectTrigger>
                    <SelectContent>
                      {adAccounts.map((account) => (
                        <SelectItem key={account.meta_ad_account_id} value={account.meta_ad_account_id}>
                          {account.name || account.meta_ad_account_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Campaign</Label>
                  <div className="flex gap-2">
                    <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                      <SelectTrigger>
                        <SelectValue placeholder={loadingCampaigns ? 'Loading campaigns...' : 'Select campaign'} />
                      </SelectTrigger>
                      <SelectContent>
                        {campaigns.map((campaign) => (
                          <SelectItem key={campaign.id} value={campaign.id}>
                            {campaign.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => void handleLinkCampaign()}
                      disabled={linking || !selectedCampaignId || !selectedAdAccountId}
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      {linking ? 'Linking...' : 'Link to Farm'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {callbackNotice ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {callbackNotice}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Linked Meta campaigns</h2>
            <p className="text-xs text-muted-foreground">Last synced: {formatDate(summary.last_synced_date)}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => void handleSync()}
            disabled={syncing || links.filter((link) => link.status === 'active').length === 0 || !connection?.connected}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </Button>
        </div>

        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Meta campaigns linked to this farm yet.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {links.map((link) => {
              const cpl = link.metrics_summary.leads > 0
                ? link.metrics_summary.spend / link.metrics_summary.leads
                : null;
              const lastSynced = link.metrics_summary.last_synced_date || link.last_synced_at || null;
              const loadedAds = adsByCampaignId[link.meta_campaign_id] ?? null;
              const loadingAds = Boolean(loadingAdsByCampaignId[link.meta_campaign_id]);

              return (
                <Card key={link.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-medium text-foreground">
                            {link.meta_campaign_name || 'Meta campaign'}
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">{link.meta_campaign_id}</p>
                        </div>
                        <Badge variant={link.status === 'active' ? 'secondary' : 'outline'}>
                          {link.status || 'active'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Last synced</p>
                          <p className="font-medium">{formatDate(lastSynced)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Spend</p>
                          <p className="font-medium">{formatCurrency(link.metrics_summary.spend, currency)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Reach</p>
                          <p className="font-medium">{formatInteger(link.metrics_summary.reach)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Impressions</p>
                          <p className="font-medium">{formatInteger(link.metrics_summary.impressions)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Clicks</p>
                          <p className="font-medium">{formatInteger(link.metrics_summary.clicks)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Leads</p>
                          <p className="font-medium">{formatInteger(link.metrics_summary.leads)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Cost per lead</p>
                          <p className="font-medium">{cpl == null ? '-' : formatCurrency(cpl, currency)}</p>
                        </div>
                      </div>

                      {loadedAds ? (
                        <div className="rounded-lg border border-border bg-muted/20 p-3">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">Ads</p>
                            <p className="text-xs text-muted-foreground">{loadedAds.length} ads</p>
                          </div>
                          {loadedAds.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No ads returned for this campaign.</p>
                          ) : (
                            <div className="space-y-3">
                              {loadedAds.map((ad) => {
                                const adCpl = ad.metrics.leads > 0 ? ad.metrics.spend / ad.metrics.leads : null;
                                return (
                                  <div key={ad.id} className="grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-[72px_minmax(0,1fr)]">
                                    <div className="h-16 w-full overflow-hidden rounded-md bg-muted sm:w-16">
                                      {ad.creative?.thumbnail_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={ad.creative.thumbnail_url}
                                          alt=""
                                          className="h-full w-full object-cover"
                                          referrerPolicy="no-referrer"
                                        />
                                      ) : null}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className="truncate text-sm font-medium text-foreground">{ad.name}</p>
                                          <p className="text-xs text-muted-foreground">{ad.effective_status || ad.status || 'Unknown status'}</p>
                                        </div>
                                        <p className="text-sm font-semibold text-foreground">
                                          {formatCurrency(ad.metrics.spend, currency)}
                                        </p>
                                      </div>
                                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                                        <div>
                                          <p className="text-muted-foreground">Reach</p>
                                          <p className="font-medium">{formatInteger(ad.metrics.reach)}</p>
                                        </div>
                                        <div>
                                          <p className="text-muted-foreground">Impressions</p>
                                          <p className="font-medium">{formatInteger(ad.metrics.impressions)}</p>
                                        </div>
                                        <div>
                                          <p className="text-muted-foreground">Clicks</p>
                                          <p className="font-medium">{formatInteger(ad.metrics.clicks)}</p>
                                        </div>
                                        <div>
                                          <p className="text-muted-foreground">Leads</p>
                                          <p className="font-medium">{formatInteger(ad.metrics.leads)}</p>
                                        </div>
                                        <div>
                                          <p className="text-muted-foreground">CPL</p>
                                          <p className="font-medium">{adCpl == null ? '-' : formatCurrency(adCpl, currency)}</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleLoadAds(link.meta_campaign_id)}
                          disabled={loadingAds || !connection?.connected}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          {loadingAds ? 'Loading Ads...' : loadedAds ? 'Refresh Ads' : 'View Ads'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void handleSync()} disabled={syncing || !connection?.connected}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Sync Now
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void handleUnlink(link.id)}>
                          Unlink
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
