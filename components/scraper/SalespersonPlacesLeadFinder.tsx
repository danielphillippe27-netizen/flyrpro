'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  ListChecks,
  Loader2,
  MapPin,
  Phone,
  Search,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PlacesLead } from '@/lib/scraper/googlePlacesLeadSearch';
import {
  MapboxAutocompleteService,
  type CitySuggestion,
} from '@/lib/services/MapboxAutocompleteService';
import { useWorkspace } from '@/lib/workspace-context';

type PlacesLeadPayload = {
  ok?: boolean;
  startedAt?: string;
  completedAt?: string;
  queryCount?: number;
  rawResultCount?: number;
  uniqueResultCount?: number;
  jobSignalCount?: number;
  jobSignalRawCount?: number;
  jobSignalProvider?: string | null;
  leadSource?: 'places' | 'job_signals';
  prospects?: PlacesLead[];
  savedList?: {
    listId: string | null;
    listName: string;
    contactIds: string[];
    contactCount: number;
    dialerLeadIds: string[];
    dialerImportedCount: number;
    dialerSkippedCount: number;
    warning: string | null;
  } | null;
  error?: string;
};

type MetricCardProps = {
  label: string;
  value: string;
};

type ProspectMarket = {
  id: string;
  country_code: string;
  region: string;
  city: string;
  label: string;
  priority: number;
};

type ProspectIndustry = {
  id: string;
  name: string;
  slug: string;
  default_terms: string[];
  priority: number;
};

type ProspectSearchRun = {
  id: string;
  market_id: string | null;
  industry_id: string | null;
  city: string;
  region: string | null;
  country_code: string;
  industry: string;
  raw_count: number;
  unique_count: number;
  saved_count: number;
  dialer_count: number;
  status: string;
  completed_at: string | null;
  created_at: string;
};

type ProspectingOptionsPayload = {
  workspaceId?: string | null;
  markets?: ProspectMarket[];
  industries?: ProspectIndustry[];
  recentRuns?: ProspectSearchRun[];
  jobSignals?: {
    configured?: boolean;
    provider?: string | null;
  };
  error?: string;
};

const countryOptions = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
];

function normalizeInput(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isRealEstateIndustry(value: string): boolean {
  const normalized = normalizeInput(value);
  return (
    normalized.includes('real estate') ||
    normalized.includes('realtor') ||
    normalized.includes('brokerage') ||
    normalized.includes('property agent')
  );
}

function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const term of terms) {
    const clean = term.trim();
    const key = normalizeInput(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }

  return output;
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildPlacesCsv(prospects: PlacesLead[]): string {
  const headers = [
    'place_id',
    'name',
    'city',
    'industry',
    'phone',
    'website',
    'website_domain',
    'address',
    'google_maps_url',
    'rating',
    'user_rating_count',
    'primary_type',
    'business_status',
    'confidence_score',
    'lead_category',
    'evidence_summary',
    'source_query',
    'job_signal_count',
    'top_job_source',
    'top_job_title',
    'top_job_url',
  ];
  const rows = prospects.map((lead) => [
    lead.placeId,
    lead.name,
    lead.city,
    lead.industry,
    lead.phone,
    lead.website,
    lead.websiteDomain,
    lead.formattedAddress,
    lead.googleMapsUrl,
    lead.rating,
    lead.userRatingCount,
    lead.primaryType,
    lead.businessStatus,
    lead.confidenceScore,
    lead.leadCategory ?? '',
    lead.evidenceSummary ?? '',
    lead.query,
    lead.jobSignals?.length ?? 0,
    lead.jobSignals?.[0]?.source ?? '',
    lead.jobSignals?.[0]?.title ?? '',
    lead.jobSignals?.[0]?.url ?? '',
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

function buildCallSheet(prospects: PlacesLead[]): string {
  return prospects
    .map((lead, index) => {
      const parts = [
        `${index + 1}. ${lead.name}`,
        lead.phone ? `Phone: ${lead.phone}` : '',
        lead.website ? `Website: ${lead.website}` : '',
        lead.formattedAddress ? `Address: ${lead.formattedAddress}` : '',
        ...(lead.jobSignals ?? []).slice(0, 2).map((signal) => `Hiring signal: ${signal.source} - ${signal.title} (${signal.url})`),
        lead.googleMapsUrl ? `Maps: ${lead.googleMapsUrl}` : '',
        lead.placeId ? `Place ID: ${lead.placeId}` : '',
      ].filter(Boolean);
      return parts.join('\n');
    })
    .join('\n\n');
}

async function copyText(value: string): Promise<boolean> {
  if (!value || typeof window === 'undefined') return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatRating(lead: PlacesLead): string {
  if (typeof lead.rating !== 'number') return '-';
  const count = typeof lead.userRatingCount === 'number' ? ` (${lead.userRatingCount})` : '';
  return `${lead.rating.toFixed(1)}${count}`;
}

function formatRunDate(value: string | null | undefined): string {
  if (!value) return 'never';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function SalespersonPlacesLeadFinder() {
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const [markets, setMarkets] = useState<ProspectMarket[]>([]);
  const [industries, setIndustries] = useState<ProspectIndustry[]>([]);
  const [recentRuns, setRecentRuns] = useState<ProspectSearchRun[]>([]);
  const [prospectingWorkspaceId, setProspectingWorkspaceId] = useState<string | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [selectedIndustryId, setSelectedIndustryId] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [cityAutocompleteOpen, setCityAutocompleteOpen] = useState(false);
  const [cityAutocompleteLoading, setCityAutocompleteLoading] = useState(false);
  const [city, setCity] = useState('');
  const [industry, setIndustry] = useState('');
  const [region, setRegion] = useState('');
  const [countryCode, setCountryCode] = useState('US');
  const [relatedTerms, setRelatedTerms] = useState('');
  const [realEstateTeamSearch, setRealEstateTeamSearch] = useState(false);
  const [prospects, setProspects] = useState<PlacesLead[]>([]);
  const [summary, setSummary] = useState<PlacesLeadPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const cityAbortRef = useRef<AbortController | null>(null);
  const cityBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const realEstateMode = isRealEstateIndustry(industry);
  const saveWorkspaceId = currentWorkspaceId ?? prospectingWorkspaceId;
  const canSubmit = city.trim().length >= 2 && industry.trim().length >= 2 && !loading;
  const csv = useMemo(() => buildPlacesCsv(prospects), [prospects]);
  const cityMarketSuggestions = useMemo(() => {
    const query = normalizeInput(city);
    const matches = query
      ? markets.filter((market) =>
          normalizeInput([market.city, market.region, market.country_code, market.label].join(' ')).includes(query)
        )
      : markets;
    return matches.slice(0, 8);
  }, [city, markets]);
  const selectedRun = useMemo(() => {
    if (!selectedMarketId || !selectedIndustryId) return null;
    return recentRuns.find(
      (run) => run.market_id === selectedMarketId && run.industry_id === selectedIndustryId
    ) ?? null;
  }, [recentRuns, selectedIndustryId, selectedMarketId]);

  const loadProspectingOptions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (currentWorkspaceId) params.set('workspaceId', currentWorkspaceId);
      const query = params.toString();
      const response = await fetch(`/api/prospecting/options${query ? `?${query}` : ''}`, { credentials: 'include' });
      const payload = (await response.json().catch(() => ({}))) as ProspectingOptionsPayload;
      if (!response.ok) throw new Error(payload.error || 'Failed to load prospecting picks.');
      setProspectingWorkspaceId(payload.workspaceId ?? null);
      setMarkets(payload.markets ?? []);
      setIndustries(payload.industries ?? []);
      setRecentRuns(payload.recentRuns ?? []);
    } catch {
      setProspectingWorkspaceId(null);
      setMarkets([]);
      setIndustries([]);
      setRecentRuns([]);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    void loadProspectingOptions();
  }, [loadProspectingOptions]);

  useEffect(() => {
    if (!realEstateMode) setRealEstateTeamSearch(false);
  }, [realEstateMode]);

  useEffect(() => {
    return () => {
      cityAbortRef.current?.abort();
      if (cityBlurRef.current) clearTimeout(cityBlurRef.current);
    };
  }, []);

  useEffect(() => {
    cityAbortRef.current?.abort();
    const query = city.trim();
    if (!cityAutocompleteOpen || query.length < 3) {
      setCitySuggestions([]);
      setCityAutocompleteLoading(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      const controller = new AbortController();
      cityAbortRef.current = controller;
      setCityAutocompleteLoading(true);

      MapboxAutocompleteService.searchCities(query, undefined, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setCitySuggestions(results);
        })
        .catch((searchError) => {
          if (searchError instanceof Error && searchError.name === 'AbortError') return;
          if (!controller.signal.aborted) setCitySuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setCityAutocompleteLoading(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [city, cityAutocompleteOpen]);

  function handleMarketSelect(market: ProspectMarket) {
    setSelectedMarketId(market.id);
    setCity(market.city);
    setRegion(market.region);
    setCountryCode(market.country_code);
    setCityAutocompleteOpen(false);
    setCitySuggestions([]);
  }

  function findMarketForCity(nextCity: string, nextCountryCode = countryCode): ProspectMarket | undefined {
    return markets.find((item) => {
      return normalizeInput(item.city) === normalizeInput(nextCity) && item.country_code === nextCountryCode;
    });
  }

  function handleIndustrySelect(value: string) {
    const prospectIndustry = industries.find((item) => item.id === value);
    if (!prospectIndustry) return;
    setSelectedIndustryId(value);
    setIndustry(prospectIndustry.name);
    setRelatedTerms(prospectIndustry.default_terms.join(', '));
  }

  function handleCountrySelect(value: string) {
    const market = findMarketForCity(city, value);
    setCountryCode(value);
    setSelectedMarketId(market?.id ?? '');
    setRegion(market?.region ?? '');
  }

  function handleCityChange(value: string) {
    const market = findMarketForCity(value);
    setCity(value);
    setSelectedMarketId(market?.id ?? '');
    setRegion(market?.region ?? '');
    setCityAutocompleteOpen(true);
  }

  function handleCitySuggestionSelect(suggestion: CitySuggestion) {
    const nextCountryCode = suggestion.countryCode ?? countryCode;
    const market = findMarketForCity(suggestion.city, nextCountryCode);
    setCity(suggestion.city);
    setRegion(market?.region ?? suggestion.region);
    if (suggestion.countryCode) setCountryCode(suggestion.countryCode);
    setSelectedMarketId(market?.id ?? '');
    setCityAutocompleteOpen(false);
    setCitySuggestions([]);
  }

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || city.trim().length < 2 || industry.trim().length < 2) return;

    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      const typedRelatedTerms = relatedTerms
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);
      const teamTerms =
        realEstateMode && realEstateTeamSearch
          ? ['real estate team', 'realtor team', 'real estate group', 'real estate collective', 'real estate associates']
          : [];
      const leadIntent = realEstateMode
        ? realEstateTeamSearch
          ? 'real_estate_teams'
          : 'real_estate_agents'
        : 'generic';

      const response = await fetch('/api/salesperson/google-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          city,
          industry,
          countryCode,
          region: region.trim() || undefined,
          workspaceId: saveWorkspaceId ?? undefined,
          relatedTerms: uniqueTerms([...teamTerms, ...typedRelatedTerms]).slice(0, 12),
          pageSize: 20,
          marketId: selectedMarketId || undefined,
          industryId: selectedIndustryId || undefined,
          leadSource: 'places',
          leadIntent,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as PlacesLeadPayload;
      if (!response.ok) {
        throw new Error(payload.error || 'Google Places lead search failed.');
      }

      const nextProspects = payload.prospects ?? [];
      setProspects(nextProspects);
      setSummary(payload);
      const saved = payload.savedList;
      setStatus(
        saved
          ? `${nextProspects.length.toLocaleString()} ${leadIntent === 'real_estate_teams' ? 'team leads' : leadIntent === 'real_estate_agents' ? 'agent leads' : 'leads'} found. Saved "${saved.listName}" with ${saved.contactCount.toLocaleString()} list rows and ${saved.dialerLeadIds.length.toLocaleString()} dialer rows.`
          : `${nextProspects.length.toLocaleString()} ${leadIntent === 'real_estate_teams' ? 'team leads' : leadIntent === 'real_estate_agents' ? 'agent leads' : 'leads'} found.`
      );
      void loadProspectingOptions();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Google Places lead search failed.';
      setError(message);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!prospects.length) {
      setStatus('Run a search first.');
      return;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `places-leads-${city.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setStatus('CSV exported.');
  }

  async function copyCallSheet() {
    if (!prospects.length) {
      setStatus('Run a search first.');
      return;
    }
    const copied = await copyText(buildCallSheet(prospects));
    setStatus(copied ? 'Call sheet copied.' : 'Copy failed.');
  }

  async function copyLead(lead: PlacesLead) {
    const copied = await copyText(buildCallSheet([lead]));
    setStatus(copied ? `${lead.name} copied.` : 'Copy failed.');
  }

  function openSavedListInDialer() {
    const saved = summary?.savedList;
    if (!saved?.dialerLeadIds?.length) {
      router.push('/dialer');
      return;
    }

    const params = new URLSearchParams();
    params.set('leadIds', saved.dialerLeadIds.join(','));
    params.set('listName', saved.listName);
    if (saveWorkspaceId) params.set('workspaceId', saveWorkspaceId);
    router.push(`/dialer?${params.toString()}`);
  }

  function openSavedListInLeads() {
    const saved = summary?.savedList;
    if (!saved?.listId) {
      router.push('/leads');
      return;
    }

    const params = new URLSearchParams();
    params.set('listId', saved.listId);
    params.set('listName', saved.listName);
    router.push(`/leads?${params.toString()}`);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-border bg-card p-4 shadow-sm">
        <form className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_180px_auto_auto]" onSubmit={runSearch}>
          {selectedRun ? (
            <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 lg:col-span-full">
              Last hit {formatRunDate(selectedRun.completed_at ?? selectedRun.created_at)}: {selectedRun.unique_count.toLocaleString()} unique, {selectedRun.dialer_count.toLocaleString()} dialer rows.
            </div>
          ) : selectedMarketId && selectedIndustryId ? (
            <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200 lg:col-span-full">
              Not hit yet.
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="places-city">City</Label>
            <div className="relative">
              <Input
                id="places-city"
                value={city}
                onChange={(event) => handleCityChange(event.target.value)}
                onFocus={() => {
                  setCityAutocompleteOpen(true);
                }}
                onBlur={() => {
                  cityBlurRef.current = setTimeout(() => setCityAutocompleteOpen(false), 150);
                }}
                placeholder="Start typing a city"
                autoComplete="off"
              />
              {cityAutocompleteLoading ? (
                <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : null}
              {cityAutocompleteOpen && (cityMarketSuggestions.length > 0 || citySuggestions.length > 0 || cityAutocompleteLoading) ? (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                  {cityMarketSuggestions.map((market) => (
                    <button
                      key={market.id}
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleMarketSelect(market)}
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{market.city}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[market.region, market.country_code].filter(Boolean).join(', ')}
                        </span>
                      </span>
                    </button>
                  ))}
                  {citySuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleCitySuggestionSelect(suggestion)}
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{suggestion.city}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[suggestion.region, suggestion.countryCode].filter(Boolean).join(', ')}
                        </span>
                      </span>
                    </button>
                  ))}
                  {cityAutocompleteLoading && cityMarketSuggestions.length === 0 && citySuggestions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Searching cities...</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Industry</Label>
            <Select value={selectedIndustryId || undefined} onValueChange={handleIndustrySelect}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick an industry" />
              </SelectTrigger>
              <SelectContent>
                {industries.map((item, index) => (
                  <SelectItem key={item.id} value={item.id}>
                    {index + 1}. {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Country</Label>
            <Select value={countryCode} onValueChange={handleCountrySelect}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {countryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {realEstateMode ? (
            <div className="space-y-2">
              <Label>Target</Label>
              <div className="grid h-9 grid-cols-2 rounded-md border border-input bg-background p-0.5">
                <button
                  type="button"
                  aria-pressed={!realEstateTeamSearch}
                  className={
                    !realEstateTeamSearch
                      ? 'rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground'
                      : 'rounded-sm px-3 text-sm font-medium text-muted-foreground hover:text-foreground'
                  }
                  onClick={() => setRealEstateTeamSearch(false)}
                >
                  Agents
                </button>
                <button
                  type="button"
                  aria-pressed={realEstateTeamSearch}
                  className={
                    realEstateTeamSearch
                      ? 'rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground'
                      : 'rounded-sm px-3 text-sm font-medium text-muted-foreground hover:text-foreground'
                  }
                  onClick={() => setRealEstateTeamSearch(true)}
                >
                  Teams
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex items-end">
            <Button type="submit" disabled={!canSubmit} className="w-full">
              {loading ? <Loader2 className="animate-spin" /> : <Search />}
              Search
            </Button>
          </div>
          <div className="flex items-end gap-2 lg:col-span-full">
            <Button type="button" variant="outline" className="flex-1" onClick={copyCallSheet}>
              <Copy />
              Copy
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={exportCsv}>
              <Download />
              CSV
            </Button>
          </div>
        </form>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Unique" value={(summary?.uniqueResultCount ?? prospects.length).toLocaleString()} />
        <MetricCard
          label="Raw"
          value={(summary?.rawResultCount ?? 0).toLocaleString()}
        />
        <MetricCard label="Queries" value={(summary?.queryCount ?? 0).toLocaleString()} />
      </div>

      {(error || status) && (
        <div
          className={
            error
              ? 'rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'
              : 'rounded-md border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300'
          }
        >
          {error ?? status}
        </div>
      )}

      {summary?.savedList ? (
        <section className="rounded-md border border-emerald-500/25 bg-emerald-500/10 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                <p className="font-medium text-foreground">{summary.savedList.listName}</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {summary.savedList.contactCount.toLocaleString()} saved to this list.{' '}
                {summary.savedList.dialerImportedCount.toLocaleString()} added to the dialer
                {summary.savedList.dialerSkippedCount > 0
                  ? `, ${summary.savedList.dialerSkippedCount.toLocaleString()} already queued`
                  : ''}
                .
              </p>
              {summary.savedList.warning ? (
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{summary.savedList.warning}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={openSavedListInLeads}>
                <ListChecks />
                Open in Leads
              </Button>
              <Button type="button" onClick={openSavedListInDialer}>
                <Phone />
                Open in Dialer
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">Places leads</h2>
          </div>
          <Badge variant="outline">{prospects.length.toLocaleString()} shown</Badge>
        </div>

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Searching Google Places
          </div>
        ) : prospects.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px] px-4">Business</TableHead>
                <TableHead className="min-w-[180px]">Contact</TableHead>
                <TableHead className="min-w-[260px]">Address</TableHead>
                <TableHead className="min-w-[120px]">Rating</TableHead>
                <TableHead className="min-w-[120px]">Score</TableHead>
                <TableHead className="w-[160px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prospects.map((lead) => (
                <TableRow key={lead.placeId || `${lead.name}-${lead.formattedAddress}`}>
                  <TableCell className="px-4 whitespace-normal">
                    <div className="max-w-[340px]">
                      <p className="font-medium text-foreground">{lead.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{lead.primaryType || lead.industry}</p>
                      {lead.websiteDomain ? (
                        <p className="mt-1 text-xs text-muted-foreground">{lead.websiteDomain}</p>
                      ) : null}
                      {lead.jobSignals?.[0] ? (
                        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                          {lead.jobSignals[0].source}: {lead.jobSignals[0].title}
                        </p>
                      ) : null}
                      {lead.evidenceSummary ? (
                        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                          {lead.evidenceSummary}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {lead.phone ? (
                        <a
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          href={`tel:${lead.phone}`}
                        >
                          <Phone className="h-3.5 w-3.5" />
                          {lead.phone}
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                      {lead.website ? (
                        <a
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          href={lead.website}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Globe2 className="h-3.5 w-3.5" />
                          Website
                        </a>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="max-w-[320px] text-sm text-muted-foreground">
                      {lead.formattedAddress || '-'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-sm">
                      <Star className="h-3.5 w-3.5 text-amber-500" />
                      {formatRating(lead)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={lead.confidenceScore >= 75 ? 'default' : 'secondary'}
                      className={lead.confidenceScore >= 75 ? 'bg-emerald-600 text-white' : ''}
                    >
                      {lead.confidenceScore}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void copyLead(lead)}
                        title="Copy"
                        aria-label={`Copy ${lead.name}`}
                      >
                        <Copy />
                      </Button>
                      {lead.googleMapsUrl ? (
                        <Button type="button" variant="ghost" size="icon-sm" asChild>
                          <a
                            href={lead.googleMapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open map"
                            aria-label={`Open ${lead.name} in Google Maps`}
                          >
                            <MapPin />
                          </a>
                        </Button>
                      ) : null}
                      {lead.website ? (
                        <Button type="button" variant="ghost" size="icon-sm" asChild>
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noreferrer"
                            title="Open website"
                            aria-label={`Open ${lead.name} website`}
                          >
                            <ExternalLink />
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex min-h-[260px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
            No Places leads yet.
          </div>
        )}
      </section>
    </div>
  );
}
