'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Calculator, DollarSign, Megaphone, Package, ReceiptText, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createClient } from '@/lib/supabase/client';
import { FinanceService } from '@/lib/services/FinanceService';
import type { FinanceEntry, FinanceEntryCategory } from '@/types/database';

type AddressLike = {
  postal_code?: string | null;
};

type FinancePanelProps = {
  targetType: 'campaign' | 'farm';
  targetId: string;
  workspaceId?: string | null;
  addresses: AddressLike[];
};

type UserProfileRow = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
};

type FarmMetaAdSpendRow = {
  spend: number | string | null;
};

const CATEGORY_OPTIONS: Array<{ value: FinanceEntryCategory; label: string }> = [
  { value: 'postal_drop', label: 'Postal Drop' },
  { value: 'printing', label: 'Printing' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'materials', label: 'Materials' },
  { value: 'software', label: 'Software' },
  { value: 'ads', label: 'Ads' },
  { value: 'other', label: 'Other' },
];

function normalizePostalCode(value: string | null | undefined): string {
  return (value || '').toUpperCase().replace(/\s+/g, '').trim();
}

function formatPostalCode(value: string): string {
  const normalized = normalizePostalCode(value);
  if (normalized.length === 6) {
    return `${normalized.slice(0, 3)} ${normalized.slice(3)}`;
  }
  return normalized;
}

function parseCurrencyToCents(value: string): number {
  const normalized = value.replace(/[^0-9.]/g, '').trim();
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function parseNonNegativeInteger(value: string): number {
  return Math.max(0, Number.parseInt(value || '0', 10) || 0);
}

function formatCurrencyFromCents(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(value / 100);
}

function formatCentsForInput(value: number): string {
  return (value / 100).toFixed(2);
}

function buildDisplayName(profile: UserProfileRow | undefined, fallback: string): string {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  return fullName || fallback;
}

export function FinancePanel({
  targetType,
  targetId,
  workspaceId,
  addresses,
}: FinancePanelProps) {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [metaAdSpendCents, setMetaAdSpendCents] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingPostal, setSavingPostal] = useState(false);
  const [savingSocialAd, setSavingSocialAd] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [postalCode, setPostalCode] = useState('');
  const [postalHomeCount, setPostalHomeCount] = useState('');
  const [postalHomeCountTouched, setPostalHomeCountTouched] = useState(false);
  const [postalTotalCost, setPostalTotalCost] = useState('0');
  const [bundlingCost, setBundlingCost] = useState('0');
  const [deliveryCost, setDeliveryCost] = useState('0');
  const [otherCost, setOtherCost] = useState('0');
  const [postalNotes, setPostalNotes] = useState('');
  const [postalDate, setPostalDate] = useState(new Date().toISOString().slice(0, 10));

  const [socialAdPlatform, setSocialAdPlatform] = useState('Meta');
  const [socialAdObjective, setSocialAdObjective] = useState('Traffic');
  const [socialAdCampaignName, setSocialAdCampaignName] = useState('');
  const [socialAdTotal, setSocialAdTotal] = useState('');
  const [socialAdImpressions, setSocialAdImpressions] = useState('');
  const [socialAdClicks, setSocialAdClicks] = useState('');
  const [socialAdLeads, setSocialAdLeads] = useState('');
  const [socialAdDate, setSocialAdDate] = useState(new Date().toISOString().slice(0, 10));
  const [socialAdNotes, setSocialAdNotes] = useState('');

  const [expenseCategory, setExpenseCategory] = useState<FinanceEntryCategory>('materials');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseVendor, setExpenseVendor] = useState('');
  const [expensePostalCode, setExpensePostalCode] = useState('');
  const [expenseQuantity, setExpenseQuantity] = useState('1');
  const [expenseUnitLabel, setExpenseUnitLabel] = useState('item');
  const [expenseUnitCost, setExpenseUnitCost] = useState('');
  const [expenseTotal, setExpenseTotal] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenseNotes, setExpenseNotes] = useState('');

  const matchedHomesCount = useMemo(() => {
    const normalized = normalizePostalCode(postalCode);
    if (!normalized) return 0;
    return addresses.filter((address) => normalizePostalCode(address.postal_code) === normalized).length;
  }, [addresses, postalCode]);

  useEffect(() => {
    if (!postalCode.trim()) {
      setPostalHomeCount('');
      setPostalHomeCountTouched(false);
      return;
    }

    if (!postalHomeCountTouched) {
      setPostalHomeCount(String(matchedHomesCount));
    }
  }, [matchedHomesCount, postalCode, postalHomeCountTouched]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await FinanceService.fetchEntriesForTarget({
        campaignId: targetType === 'campaign' ? targetId : null,
        farmId: targetType === 'farm' ? targetId : null,
      });
      setEntries(data);

      if (targetType === 'farm') {
        const supabase = createClient();
        const { data: metaRows, error: metaSpendError } = await supabase
          .from('farm_meta_ad_daily_metrics')
          .select('spend')
          .eq('farm_id', targetId);

        if (metaSpendError) {
          setMetaAdSpendCents(0);
        } else {
          const syncedSpendCents = ((metaRows ?? []) as FarmMetaAdSpendRow[]).reduce(
            (sum, row) => sum + Math.round(Number(row.spend || 0) * 100),
            0
          );
          setMetaAdSpendCents(syncedSpendCents);
        }
      } else {
        setMetaAdSpendCents(0);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load finance entries');
      setMetaAdSpendCents(0);
    } finally {
      setLoading(false);
    }
  }, [targetId, targetType]);

  useEffect(() => {
    const supabase = createClient();

    const run = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);
      await loadEntries();
    };

    run();
  }, [loadEntries]);

  useEffect(() => {
    const supabase = createClient();

    const run = async () => {
      const userIds = Array.from(
        new Set(
          entries
            .flatMap((entry) => [entry.created_by, entry.agent_user_id])
            .filter((value): value is string => Boolean(value))
        )
      );

      if (userIds.length === 0) {
        setProfileNames({});
        return;
      }

      const { data, error: profileError } = await supabase
        .from('user_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', userIds);

      if (profileError) return;

      const names = Object.fromEntries(
        ((data || []) as UserProfileRow[]).map((profile) => [
          profile.user_id,
          buildDisplayName(profile, 'Member'),
        ])
      );
      setProfileNames(names);
    };

    run();
  }, [entries]);

  const manualSpendCents = useMemo(
    () => entries.reduce((sum, entry) => sum + Number(entry.total_cost_cents || 0), 0),
    [entries]
  );

  const totalSpendCents = manualSpendCents + metaAdSpendCents;

  const manualSocialAdSpendCents = useMemo(
    () =>
      entries
        .filter((entry) => entry.category === 'ads')
        .reduce((sum, entry) => sum + Number(entry.total_cost_cents || 0), 0),
    [entries]
  );

  const totalSocialAdSpendCents = manualSocialAdSpendCents + metaAdSpendCents;

  const postalSpendCents = useMemo(
    () =>
      entries
        .filter((entry) => entry.category === 'postal_drop')
        .reduce((sum, entry) => sum + Number(entry.total_cost_cents || 0), 0),
    [entries]
  );

  const mySpendCents = useMemo(() => {
    if (!currentUserId) return 0;
    return entries.reduce((sum, entry) => {
      const spenderId = entry.agent_user_id || entry.created_by;
      return spenderId === currentUserId ? sum + Number(entry.total_cost_cents || 0) : sum;
    }, 0);
  }, [currentUserId, entries]);

  const averageCostPerHomeCents = useMemo(() => {
    if (addresses.length === 0) return 0;
    return Math.round(totalSpendCents / addresses.length);
  }, [addresses.length, totalSpendCents]);

  const categoryTotals = useMemo(() => {
    const totals = new Map<FinanceEntryCategory, number>();
    for (const entry of entries) {
      totals.set(entry.category, (totals.get(entry.category) ?? 0) + Number(entry.total_cost_cents || 0));
    }
    if (metaAdSpendCents > 0) {
      totals.set('ads', (totals.get('ads') ?? 0) + metaAdSpendCents);
    }
    return CATEGORY_OPTIONS.map((option) => ({
      ...option,
      total_cents: totals.get(option.value) ?? 0,
    })).filter((option) => option.total_cents > 0);
  }, [entries, metaAdSpendCents]);

  const postalDropTotalCents = parseCurrencyToCents(postalTotalCost);
  const postalAllocatedCostCents =
    parseCurrencyToCents(bundlingCost) +
    parseCurrencyToCents(deliveryCost) +
    parseCurrencyToCents(otherCost);
  const printingCostCents = Math.max(0, postalDropTotalCents - postalAllocatedCostCents);
  const postalAllocationOverflow = postalAllocatedCostCents > postalDropTotalCents;

  const postalCostPerHomeCents = useMemo(() => {
    const quantity = parseNonNegativeInteger(postalHomeCount);
    if (quantity <= 0 || postalDropTotalCents <= 0) return 0;
    return Math.round(postalDropTotalCents / quantity);
  }, [postalDropTotalCents, postalHomeCount]);

  const socialAdTotalCents = parseCurrencyToCents(socialAdTotal);
  const socialAdLeadCount = parseNonNegativeInteger(socialAdLeads);
  const socialAdCostPerLeadCents =
    socialAdLeadCount > 0 && socialAdTotalCents > 0 ? Math.round(socialAdTotalCents / socialAdLeadCount) : 0;

  const savePostalDrop = async () => {
    if (!currentUserId) {
      setError('You must be signed in to save finance entries');
      return;
    }

    const quantity = parseNonNegativeInteger(postalHomeCount);
    if (!postalCode.trim()) {
      setError('Postal code is required for the postal-drop estimator');
      return;
    }
    if (quantity <= 0) {
      setError('Home count must be greater than zero');
      return;
    }
    if (postalDropTotalCents <= 0) {
      setError('Total cost must be greater than zero');
      return;
    }
    if (postalAllocationOverflow) {
      setError('Bundling, delivery, and other costs cannot exceed the total cost');
      return;
    }

    setSavingPostal(true);
    setError(null);
    try {
      await FinanceService.createEntry(currentUserId, {
        workspace_id: workspaceId ?? null,
        campaign_id: targetType === 'campaign' ? targetId : null,
        farm_id: targetType === 'farm' ? targetId : null,
        agent_user_id: currentUserId,
        category: 'postal_drop',
        description: `Postal drop for ${formatPostalCode(postalCode)}`,
        postal_code: formatPostalCode(postalCode),
        quantity,
        unit_label: 'homes',
        unit_cost_cents: postalCostPerHomeCents,
        total_cost_cents: postalDropTotalCents,
        incurred_on: postalDate,
        notes: postalNotes || null,
        metadata: {
          matched_homes: matchedHomesCount,
          printing_cost_cents: printingCostCents,
          bundling_cost_cents: parseCurrencyToCents(bundlingCost),
          delivery_cost_cents: parseCurrencyToCents(deliveryCost),
          other_cost_cents: parseCurrencyToCents(otherCost),
        },
      });
      setPostalCode('');
      setPostalHomeCount('');
      setPostalHomeCountTouched(false);
      setPostalTotalCost('0');
      setBundlingCost('0');
      setDeliveryCost('0');
      setOtherCost('0');
      setPostalNotes('');
      await loadEntries();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save postal-drop entry');
    } finally {
      setSavingPostal(false);
    }
  };

  const saveSocialAdSpend = async () => {
    if (!currentUserId) {
      setError('You must be signed in to save finance entries');
      return;
    }

    if (!socialAdCampaignName.trim()) {
      setError('Campaign or ad name is required for social ad spend');
      return;
    }
    if (socialAdTotalCents <= 0) {
      setError('Social ad spend must be greater than zero');
      return;
    }

    setSavingSocialAd(true);
    setError(null);
    try {
      const impressions = parseNonNegativeInteger(socialAdImpressions);
      const clicks = parseNonNegativeInteger(socialAdClicks);
      const leads = parseNonNegativeInteger(socialAdLeads);

      await FinanceService.createEntry(currentUserId, {
        workspace_id: workspaceId ?? null,
        campaign_id: targetType === 'campaign' ? targetId : null,
        farm_id: targetType === 'farm' ? targetId : null,
        agent_user_id: currentUserId,
        category: 'ads',
        description: `${socialAdPlatform} social ad spend - ${socialAdCampaignName.trim()}`,
        vendor: socialAdPlatform,
        quantity: 1,
        unit_label: 'campaign',
        unit_cost_cents: socialAdTotalCents,
        total_cost_cents: socialAdTotalCents,
        incurred_on: socialAdDate,
        notes: socialAdNotes || null,
        metadata: {
          source: 'manual_social_ad_spend',
          platform: socialAdPlatform,
          objective: socialAdObjective,
          campaign_name: socialAdCampaignName.trim(),
          impressions,
          clicks,
          leads,
          cost_per_lead_cents: leads > 0 ? Math.round(socialAdTotalCents / leads) : null,
        },
      });
      setSocialAdPlatform('Meta');
      setSocialAdObjective('Traffic');
      setSocialAdCampaignName('');
      setSocialAdTotal('');
      setSocialAdImpressions('');
      setSocialAdClicks('');
      setSocialAdLeads('');
      setSocialAdNotes('');
      await loadEntries();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save social ad spend');
    } finally {
      setSavingSocialAd(false);
    }
  };

  const saveExpense = async () => {
    if (!currentUserId) {
      setError('You must be signed in to save finance entries');
      return;
    }

    const quantity = Math.max(0, Number.parseInt(expenseQuantity || '0', 10) || 0);
    const totalCostCents = parseCurrencyToCents(expenseTotal);
    const unitCostCents = expenseUnitCost
      ? parseCurrencyToCents(expenseUnitCost)
      : quantity > 0 && totalCostCents > 0
        ? Math.round(totalCostCents / quantity)
        : 0;

    if (!expenseDescription.trim()) {
      setError('Description is required for manual expenses');
      return;
    }
    if (totalCostCents <= 0) {
      setError('Total cost must be greater than zero');
      return;
    }

    setSavingExpense(true);
    setError(null);
    try {
      await FinanceService.createEntry(currentUserId, {
        workspace_id: workspaceId ?? null,
        campaign_id: targetType === 'campaign' ? targetId : null,
        farm_id: targetType === 'farm' ? targetId : null,
        agent_user_id: currentUserId,
        category: expenseCategory,
        description: expenseDescription,
        vendor: expenseVendor || null,
        postal_code: expensePostalCode ? formatPostalCode(expensePostalCode) : null,
        quantity: quantity || 1,
        unit_label: expenseUnitLabel || 'item',
        unit_cost_cents: unitCostCents,
        total_cost_cents: totalCostCents,
        incurred_on: expenseDate,
        notes: expenseNotes || null,
      });
      setExpenseCategory('materials');
      setExpenseDescription('');
      setExpenseVendor('');
      setExpensePostalCode('');
      setExpenseQuantity('1');
      setExpenseUnitLabel('item');
      setExpenseUnitCost('');
      setExpenseTotal('');
      setExpenseNotes('');
      await loadEntries();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save finance entry');
    } finally {
      setSavingExpense(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              Total Spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatCurrencyFromCents(totalSpendCents)}</div>
            <p className="text-sm text-muted-foreground">
              {entries.length} saved entries{metaAdSpendCents > 0 ? ' + synced Meta Ads' : ''}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Megaphone className="w-4 h-4" />
              Social Ads Spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatCurrencyFromCents(totalSocialAdSpendCents)}</div>
            <p className="text-sm text-muted-foreground">
              {targetType === 'farm' && metaAdSpendCents > 0
                ? 'Manual ads + synced Meta spend'
                : 'Meta, Facebook, Instagram, and social ads'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="w-4 h-4" />
              Postal Spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatCurrencyFromCents(postalSpendCents)}</div>
            <p className="text-sm text-muted-foreground">Tracked postal-drop spending</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Cost Per Home
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">
              {addresses.length > 0 ? formatCurrencyFromCents(averageCostPerHomeCents) : '—'}
            </div>
            <p className="text-sm text-muted-foreground">{addresses.length.toLocaleString()} homes in this area</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ReceiptText className="w-4 h-4" />
              Your Spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatCurrencyFromCents(mySpendCents)}</div>
            <p className="text-sm text-muted-foreground">Entries logged under your agent spend</p>
          </CardContent>
        </Card>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-4 h-4" />
              Postal Drop Estimator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="postal-code-input">Postal code</Label>
                <Input
                  id="postal-code-input"
                  value={postalCode}
                  onChange={(event) => {
                    setPostalCode(event.target.value);
                    setPostalHomeCountTouched(false);
                  }}
                  placeholder="M5V 2T6"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postal-home-count">Homes count</Label>
                <Input
                  id="postal-home-count"
                  type="number"
                  min="0"
                  value={postalHomeCount}
                  onChange={(event) => {
                    setPostalHomeCount(event.target.value);
                    setPostalHomeCountTouched(true);
                  }}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postal-total-cost">Total cost</Label>
                <Input
                  id="postal-total-cost"
                  value={postalTotalCost}
                  onChange={(event) => setPostalTotalCost(event.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {postalCode.trim()
                ? `Matched ${matchedHomesCount.toLocaleString()} homes in this area for ${formatPostalCode(postalCode)}.`
                : 'Enter a postal code to count matching homes in this area.'}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="postal-date">Date</Label>
                <Input
                  id="postal-date"
                  type="date"
                  value={postalDate}
                  onChange={(event) => setPostalDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="printing-cost">Printing cost</Label>
                <Input
                  id="printing-cost"
                  value={formatCentsForInput(printingCostCents)}
                  readOnly
                  className="bg-muted/40"
                />
                <p className="text-xs text-muted-foreground">Auto-balanced from the total cost.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bundling-cost">Bundling cost</Label>
                <Input
                  id="bundling-cost"
                  value={bundlingCost}
                  onChange={(event) => setBundlingCost(event.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delivery-cost">Delivery cost</Label>
                <Input
                  id="delivery-cost"
                  value={deliveryCost}
                  onChange={(event) => setDeliveryCost(event.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="other-cost">Other cost</Label>
                <Input
                  id="other-cost"
                  value={otherCost}
                  onChange={(event) => setOtherCost(event.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            {postalAllocationOverflow ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Bundling, delivery, and other costs cannot be higher than the total cost.
              </div>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-end">
              <div className="space-y-2">
                <Label htmlFor="postal-notes">Notes</Label>
                <Textarea
                  id="postal-notes"
                  value={postalNotes}
                  onChange={(event) => setPostalNotes(event.target.value)}
                  placeholder="Canada Post, neighbourhood flyer run, route notes, etc."
                  className="min-h-[88px]"
                />
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <div>
                  <p className="text-sm font-medium">Calculated cost per home</p>
                  <p className="text-xs text-muted-foreground">Based on total cost and homes count.</p>
                </div>
                <div className="mt-2 text-2xl font-semibold">{formatCurrencyFromCents(postalCostPerHomeCents)}</div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={savePostalDrop} disabled={savingPostal}>
                {savingPostal ? 'Saving...' : 'Save Postal Drop'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Meta / Social Ads
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <Label>Platform</Label>
                <Select value={socialAdPlatform} onValueChange={setSocialAdPlatform}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Meta">Meta</SelectItem>
                    <SelectItem value="Facebook">Facebook</SelectItem>
                    <SelectItem value="Instagram">Instagram</SelectItem>
                    <SelectItem value="TikTok">TikTok</SelectItem>
                    <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                    <SelectItem value="Other social ads">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Objective</Label>
                <Select value={socialAdObjective} onValueChange={setSocialAdObjective}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Traffic">Traffic</SelectItem>
                    <SelectItem value="Leads">Leads</SelectItem>
                    <SelectItem value="Reach">Reach</SelectItem>
                    <SelectItem value="Awareness">Awareness</SelectItem>
                    <SelectItem value="Listing promotion">Listing promotion</SelectItem>
                    <SelectItem value="Open house">Open house</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="social-ad-date">Date</Label>
                <Input
                  id="social-ad-date"
                  type="date"
                  value={socialAdDate}
                  onChange={(event) => setSocialAdDate(event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2 xl:col-span-3">
                <Label htmlFor="social-ad-campaign">Campaign or ad name</Label>
                <Input
                  id="social-ad-campaign"
                  value={socialAdCampaignName}
                  onChange={(event) => setSocialAdCampaignName(event.target.value)}
                  placeholder="Meta lead ad, Instagram listing boost, retargeting campaign"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="social-ad-total">Ad spend</Label>
                <Input
                  id="social-ad-total"
                  value={socialAdTotal}
                  onChange={(event) => setSocialAdTotal(event.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="social-ad-impressions">Impressions</Label>
                <Input
                  id="social-ad-impressions"
                  type="number"
                  min="0"
                  value={socialAdImpressions}
                  onChange={(event) => setSocialAdImpressions(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="social-ad-clicks">Clicks</Label>
                <Input
                  id="social-ad-clicks"
                  type="number"
                  min="0"
                  value={socialAdClicks}
                  onChange={(event) => setSocialAdClicks(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="social-ad-leads">Leads</Label>
                <Input
                  id="social-ad-leads"
                  type="number"
                  min="0"
                  value={socialAdLeads}
                  onChange={(event) => setSocialAdLeads(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="rounded-lg border border-border bg-background p-3 sm:col-span-2">
                <p className="text-sm font-medium">Cost per lead</p>
                <p className="text-xs text-muted-foreground">Based on spend and leads entered here.</p>
                <div className="mt-2 text-2xl font-semibold">{formatCurrencyFromCents(socialAdCostPerLeadCents)}</div>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div className="space-y-2">
                <Label htmlFor="social-ad-notes">Notes</Label>
                <Textarea
                  id="social-ad-notes"
                  value={socialAdNotes}
                  onChange={(event) => setSocialAdNotes(event.target.value)}
                  placeholder="Audience, creative, link, targeting notes, etc."
                  className="min-h-[88px]"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={saveSocialAdSpend} disabled={savingSocialAd}>
                  {savingSocialAd ? 'Saving...' : 'Save Social Ad'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <ReceiptText className="w-4 h-4" />
              Manual Expense
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={expenseCategory} onValueChange={(value) => setExpenseCategory(value as FinanceEntryCategory)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.filter((option) => option.value !== 'postal_drop').map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-date">Date</Label>
                <Input
                  id="expense-date"
                  type="date"
                  value={expenseDate}
                  onChange={(event) => setExpenseDate(event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2 xl:col-span-3">
                <Label htmlFor="expense-description">Description</Label>
                <Input
                  id="expense-description"
                  value={expenseDescription}
                  onChange={(event) => setExpenseDescription(event.target.value)}
                  placeholder="Flyer print order, software subscription, ad spend, etc."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-vendor">Vendor</Label>
                <Input
                  id="expense-vendor"
                  value={expenseVendor}
                  onChange={(event) => setExpenseVendor(event.target.value)}
                  placeholder="Staples, Canada Post, Meta"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-postal-code">Postal code</Label>
                <Input
                  id="expense-postal-code"
                  value={expensePostalCode}
                  onChange={(event) => setExpensePostalCode(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-quantity">Quantity</Label>
                <Input
                  id="expense-quantity"
                  type="number"
                  min="0"
                  value={expenseQuantity}
                  onChange={(event) => setExpenseQuantity(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-unit-label">Unit label</Label>
                <Input
                  id="expense-unit-label"
                  value={expenseUnitLabel}
                  onChange={(event) => setExpenseUnitLabel(event.target.value)}
                  placeholder="item"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-unit-cost">Unit cost</Label>
                <Input
                  id="expense-unit-cost"
                  value={expenseUnitCost}
                  onChange={(event) => setExpenseUnitCost(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-total">Total cost</Label>
                <Input
                  id="expense-total"
                  value={expenseTotal}
                  onChange={(event) => setExpenseTotal(event.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div className="space-y-2">
                <Label htmlFor="expense-notes">Notes</Label>
                <Textarea
                  id="expense-notes"
                  value={expenseNotes}
                  onChange={(event) => setExpenseNotes(event.target.value)}
                  placeholder="Optional notes about this spend"
                  className="min-h-[88px]"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={saveExpense} disabled={savingExpense}>
                  {savingExpense ? 'Saving...' : 'Save Expense'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Finance Entries</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Saved spend for this {targetType}, including postal drops, other operating costs,
              {targetType === 'farm' ? ' and synced Meta Ads.' : ' and manual ad spend.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryTotals.length === 0 ? (
              <Badge variant="outline">No category totals yet</Badge>
            ) : (
              categoryTotals.map((category) => (
                <Badge key={category.value} variant="secondary">
                  {category.label}: {formatCurrencyFromCents(category.total_cents)}
                </Badge>
              ))
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading finance entries...</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No finance entries yet. Save a postal drop or add a manual expense to start tracking spend.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Postal</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit Cost</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Logged By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const spenderId = entry.agent_user_id || entry.created_by;
                  const fallbackName = spenderId === currentUserId ? 'You' : 'Member';
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>{new Date(entry.incurred_on).toLocaleDateString()}</TableCell>
                      <TableCell>
                        {CATEGORY_OPTIONS.find((option) => option.value === entry.category)?.label ?? entry.category}
                      </TableCell>
                      <TableCell className="max-w-[280px] whitespace-normal">
                        <div className="font-medium">{entry.description}</div>
                        {entry.vendor ? (
                          <div className="text-xs text-muted-foreground">{entry.vendor}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{entry.postal_code || '—'}</TableCell>
                      <TableCell>
                        {entry.quantity.toLocaleString()} {entry.unit_label}
                      </TableCell>
                      <TableCell>{formatCurrencyFromCents(entry.unit_cost_cents)}</TableCell>
                      <TableCell>{formatCurrencyFromCents(entry.total_cost_cents)}</TableCell>
                      <TableCell>{profileNames[spenderId] || fallbackName}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
