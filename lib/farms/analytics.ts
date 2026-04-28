import type {
  Contact,
  FinanceEntry,
  Farm,
  FarmAddress,
  FarmLead,
  FarmTouch,
  FarmTouchAddress,
  FarmTouchInterval,
} from '@/types/database';

export type EnrichedFarmTouch = FarmTouch & {
  resolvedCycleNumber: number;
  effectiveDate: string | null;
};

export type FarmCycleBucket = {
  cycleNumber: number;
  label: string;
  visits: number;
  contacts: number;
  sessions: number;
  coverage: number;
};

export type FarmModeBreakdownItem = {
  mode: NonNullable<FarmTouch['mode']>;
  label: string;
  sessions: number;
};

export type FarmOutcomeBreakdown = {
  interested: number;
  notInterested: number;
  followUp: number;
  noAnswer: number;
  wrongFit: number;
};

export type FarmBestSession = {
  touch: EnrichedFarmTouch;
  homes: number;
  contacts: number;
};

export type FarmDashboardAnalytics = {
  touches: EnrichedFarmTouch[];
  currentCycleNumber: number;
  currentCycleLabel: string;
  currentCycleTouches: EnrichedFarmTouch[];
  currentCycleTouchIds: string[];
  cycleBuckets: FarmCycleBucket[];
  totalHomes: number;
  totalVisits: number;
  totalContacts: number;
  totalContactRate: number;
  totalSpendCents: number;
  costPerContactCents: number | null;
  costPerHomeVisitedCents: number | null;
  allTimeUniqueVisitedHomes: number;
  allTimeCoverageRate: number;
  allSessionCount: number;
  avgHomesPerSession: number;
  currentCycleVisits: number;
  currentCycleContacts: number;
  currentCycleContactRate: number;
  currentCycleCoverageCount: number;
  currentCycleCoverageRate: number;
  currentCycleSpendCents: number;
  currentCycleCostPerContactCents: number | null;
  currentCycleCostPerHomeVisitedCents: number | null;
  currentCycleAvgHomesPerSession: number;
  monthSpendCents: number;
  lastActiveAt: string | null;
  latestCompletedTouch: EnrichedFarmTouch | null;
  nextTouchDueAt: string | null;
  nextTouchDaysFromNow: number | null;
  targetCadenceDays: number;
  actualCadenceDays: number | null;
  cadenceStatus: 'on_track' | 'behind' | 'new';
  bestSession: FarmBestSession | null;
  modeBreakdown: FarmModeBreakdownItem[];
  penetration: {
    uniqueHomesTouched: number;
    repeatTouchedHomes: number;
  };
  outcomeBreakdown: FarmOutcomeBreakdown;
};

type BuildFarmDashboardAnalyticsArgs = {
  farm: Pick<Farm, 'touches_per_interval' | 'touches_interval' | 'frequency'> | null;
  addresses: FarmAddress[];
  touches: FarmTouch[];
  leads: FarmLead[];
  contacts: Contact[];
  financeEntries: FinanceEntry[];
  touchOutcomes: FarmTouchAddress[];
};

const MODE_LABELS: Record<NonNullable<FarmTouch['mode']>, string> = {
  doorknock: 'Doorknock',
  flyer: 'Flyer',
  canada_post: 'Canada Post',
  pop_by: 'Pop by',
  letter: 'Letter',
};

function getTouchCountPerInterval(
  farm: Pick<Farm, 'touches_per_interval' | 'frequency'> | null
): number {
  return 1;
}

function getTouchInterval(
  farm: Pick<Farm, 'touches_interval'> | null
): FarmTouchInterval {
  return farm?.touches_interval === 'year' ? 'year' : 'month';
}

export function getTouchEffectiveDate(touch: FarmTouch): string | null {
  return touch.completed_date ?? touch.started_at ?? touch.scheduled_date ?? touch.created_at ?? null;
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isWithinMonth(value: string | null | undefined, monthStart: Date, monthEnd: Date): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed >= monthStart && parsed < monthEnd;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function daysBetween(left: string, right: string): number {
  const diffMs = Math.abs(new Date(left).getTime() - new Date(right).getTime());
  return diffMs / (1000 * 60 * 60 * 24);
}

export function resolveFarmTouchesWithCycles(
  touches: FarmTouch[],
  touchesPerInterval: number
): EnrichedFarmTouch[] {
  void touchesPerInterval;
  const ordered = [...touches].sort((left, right) => {
    const leftValue = toTimestamp(getTouchEffectiveDate(left));
    const rightValue = toTimestamp(getTouchEffectiveDate(right));
    if (leftValue !== rightValue) return leftValue - rightValue;
    return left.id.localeCompare(right.id);
  });

  const resolvedById = new Map<string, number>();
  ordered.forEach((touch, index) => {
    const fallbackCycleNumber = index + 1;
    resolvedById.set(touch.id, Math.max(1, touch.cycle_number ?? fallbackCycleNumber));
  });

  return touches.map((touch) => ({
    ...touch,
    resolvedCycleNumber: resolvedById.get(touch.id) ?? Math.max(1, touch.cycle_number ?? 1),
    effectiveDate: getTouchEffectiveDate(touch),
  }));
}

export function getNextFarmCycleNumber(
  touches: FarmTouch[],
  touchesPerInterval: number
): number {
  void touchesPerInterval;
  const resolvedTouches = resolveFarmTouchesWithCycles(touches, touchesPerInterval);
  if (resolvedTouches.length === 0) return 1;

  const currentCycleNumber = Math.max(...resolvedTouches.map((touch) => touch.resolvedCycleNumber), 1);
  return currentCycleNumber + 1;
}

export function buildFarmDashboardAnalytics({
  farm,
  addresses,
  touches,
  leads,
  contacts,
  financeEntries,
  touchOutcomes,
}: BuildFarmDashboardAnalyticsArgs): FarmDashboardAnalytics {
  const touchesPerInterval = getTouchCountPerInterval(farm);
  const interval = getTouchInterval(farm);
  const nonNoneOutcomes = touchOutcomes.filter((outcome) => outcome.status !== 'none');
  const resolvedTouches = resolveFarmTouchesWithCycles(touches, touchesPerInterval).sort(
    (left, right) => toTimestamp(right.effectiveDate) - toTimestamp(left.effectiveDate)
  );
  const currentCycleNumber = Math.max(...resolvedTouches.map((touch) => touch.resolvedCycleNumber), 1);
  const currentCycleLabel = `Cycle ${currentCycleNumber}`;
  const currentCycleTouches = resolvedTouches.filter((touch) => touch.resolvedCycleNumber === currentCycleNumber);
  const currentCycleTouchIds = currentCycleTouches.map((touch) => touch.id);
  const completedTouches = resolvedTouches.filter((touch) => touch.status === 'completed');

  const outcomesByTouchId = new Map<string, FarmTouchAddress[]>();
  const outcomeTouchCountByAddressId = new Map<string, number>();
  for (const outcome of nonNoneOutcomes) {
    const byTouch = outcomesByTouchId.get(outcome.farm_touch_id) ?? [];
    byTouch.push(outcome);
    outcomesByTouchId.set(outcome.farm_touch_id, byTouch);
    outcomeTouchCountByAddressId.set(
      outcome.farm_address_id,
      (outcomeTouchCountByAddressId.get(outcome.farm_address_id) ?? 0) + 1
    );
  }

  const uniqueVisitedAddressIds = new Set(nonNoneOutcomes.map((outcome) => outcome.farm_address_id));
  const currentCycleOutcomes = nonNoneOutcomes.filter((outcome) => currentCycleTouchIds.includes(outcome.farm_touch_id));
  const currentCycleVisitedAddressIds = new Set(currentCycleOutcomes.map((outcome) => outcome.farm_address_id));

  const totalHomes = addresses.length;
  const totalVisits = nonNoneOutcomes.length;
  const totalContacts = Math.max(leads.length, contacts.length);
  const totalContactRate = totalVisits > 0 ? totalContacts / totalVisits : 0;
  const totalSpendCents = financeEntries.reduce((sum, entry) => sum + Number(entry.total_cost_cents ?? 0), 0);
  const costPerContactCents = totalContacts > 0 ? Math.round(totalSpendCents / totalContacts) : null;
  const costPerHomeVisitedCents = totalVisits > 0 ? Math.round(totalSpendCents / totalVisits) : null;
  const allTimeUniqueVisitedHomes = uniqueVisitedAddressIds.size;
  const allTimeCoverageRate = totalHomes > 0 ? allTimeUniqueVisitedHomes / totalHomes : 0;
  const allSessionCount = resolvedTouches.length;
  const avgHomesPerSession = resolvedTouches.length > 0 ? totalVisits / resolvedTouches.length : 0;

  const currentCycleVisits = currentCycleOutcomes.length;
  const currentCycleLeadCount = leads.filter((lead) =>
    lead.touch_id ? currentCycleTouchIds.includes(lead.touch_id) : false
  ).length;
  const currentCycleContactCount = contacts.filter((contact) =>
    contact.created_at
      ? currentCycleTouches.some((touch) => {
          const touchDate = touch.effectiveDate ?? touch.created_at;
          if (!touchDate) return false;
          return (
            new Date(contact.created_at).toDateString() === new Date(touchDate).toDateString()
          );
        })
      : false
  ).length;
  const currentCycleContacts = Math.max(currentCycleLeadCount, currentCycleContactCount);
  const currentCycleContactRate = currentCycleVisits > 0 ? currentCycleContacts / currentCycleVisits : 0;
  const currentCycleCoverageCount = currentCycleVisitedAddressIds.size;
  const currentCycleCoverageRate = totalHomes > 0 ? currentCycleCoverageCount / totalHomes : 0;

  const currentCycleSpendCents = financeEntries
    .filter((entry) =>
      currentCycleTouches.some((touch) => {
        const touchDate = touch.effectiveDate ?? touch.created_at;
        if (!touchDate) return false;
        return (
          new Date(entry.incurred_on).toDateString() === new Date(touchDate).toDateString()
        );
      })
    )
    .reduce((sum, entry) => sum + Number(entry.total_cost_cents ?? 0), 0);
  const currentCycleCostPerContactCents =
    currentCycleContacts > 0 ? Math.round(currentCycleSpendCents / currentCycleContacts) : null;
  const currentCycleCostPerHomeVisitedCents =
    currentCycleVisits > 0 ? Math.round(currentCycleSpendCents / currentCycleVisits) : null;
  const currentCycleAvgHomesPerSession =
    currentCycleTouches.length > 0 ? currentCycleVisits / currentCycleTouches.length : 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthSpendCents = financeEntries
    .filter((entry) => isWithinMonth(entry.incurred_on, monthStart, monthEnd))
    .reduce((sum, entry) => sum + Number(entry.total_cost_cents ?? 0), 0);

  const lastActiveAt =
    [
      ...completedTouches.map((touch) => touch.completed_date),
      ...resolvedTouches
        .filter((touch) => touch.status === 'in_progress')
        .map((touch) => touch.started_at ?? touch.scheduled_date),
      ...leads.map((lead) => lead.created_at),
      ...contacts.map((contact) => contact.created_at),
    ]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => toTimestamp(right) - toTimestamp(left))[0] ?? null;

  const targetCadenceDays = interval === 'year' ? 365 / touchesPerInterval : 30 / touchesPerInterval;
  const completedTouchDates = completedTouches
    .map((touch) => touch.completed_date ?? touch.effectiveDate)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => toTimestamp(left) - toTimestamp(right));
  const cadenceDiffs = completedTouchDates.slice(1).map((value, index) => daysBetween(value, completedTouchDates[index]));
  const actualCadenceDays = average(cadenceDiffs);
  const latestCompletedTouch = completedTouches[0] ?? null;
  const nextTouchDueAt = latestCompletedTouch?.completed_date
    ? new Date(
        new Date(latestCompletedTouch.completed_date).getTime() + targetCadenceDays * 24 * 60 * 60 * 1000
      ).toISOString()
    : null;
  const nextTouchDaysFromNow = nextTouchDueAt
    ? Math.round((new Date(nextTouchDueAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const cadenceStatus =
    nextTouchDaysFromNow == null
      ? 'new'
      : nextTouchDaysFromNow < 0 || (actualCadenceDays != null && actualCadenceDays > targetCadenceDays * 1.15)
        ? 'behind'
        : 'on_track';

  const leadCountByTouchId = new Map<string, number>();
  for (const lead of leads) {
    if (!lead.touch_id) continue;
    leadCountByTouchId.set(lead.touch_id, (leadCountByTouchId.get(lead.touch_id) ?? 0) + 1);
  }

  const bestSession = completedTouches.reduce<FarmBestSession | null>((best, touch) => {
    const homes = outcomesByTouchId.get(touch.id)?.length ?? Number(touch.homes_reached ?? 0);
    const candidate: FarmBestSession = {
      touch,
      homes,
      contacts: leadCountByTouchId.get(touch.id) ?? 0,
    };
    if (!best) return candidate;
    if (candidate.homes > best.homes) return candidate;
    if (candidate.homes === best.homes && candidate.contacts > best.contacts) return candidate;
    return best;
  }, null);

  const modeBreakdown = (Object.keys(MODE_LABELS) as Array<NonNullable<FarmTouch['mode']>>).map((mode) => ({
    mode,
    label: MODE_LABELS[mode],
    sessions: resolvedTouches.filter((touch) => (touch.mode ?? 'doorknock') === mode).length,
  }));

  const penetration = {
    uniqueHomesTouched: allTimeUniqueVisitedHomes,
    repeatTouchedHomes: Array.from(outcomeTouchCountByAddressId.values()).filter((count) => count > 1).length,
  };

  const outcomeBreakdown = touchOutcomes.reduce<FarmOutcomeBreakdown>(
    (result, outcome) => {
      switch (outcome.status) {
        case 'hot_lead':
        case 'appointment':
          result.interested += 1;
          break;
        case 'future_seller':
        case 'talked':
          result.followUp += 1;
          break;
        case 'no_answer':
          result.noAnswer += 1;
          break;
        case 'do_not_knock':
          result.wrongFit += 1;
          break;
        default:
          break;
      }
      return result;
    },
    { interested: 0, notInterested: 0, followUp: 0, noAnswer: 0, wrongFit: 0 }
  );

  for (const contact of contacts) {
    if (contact.status === 'cold') outcomeBreakdown.notInterested += 1;
    if (contact.status === 'hot') outcomeBreakdown.interested += 1;
    if (contact.status === 'warm' || contact.follow_up_at) outcomeBreakdown.followUp += 1;
  }

  const cycleBuckets = Array.from(
    new Set(resolvedTouches.map((touch) => touch.resolvedCycleNumber))
  )
    .sort((left, right) => right - left)
    .slice(0, 6)
    .map((cycleNumber) => {
      const cycleTouches = resolvedTouches.filter((touch) => touch.resolvedCycleNumber === cycleNumber);
      const cycleTouchIds = cycleTouches.map((touch) => touch.id);
      const cycleOutcomes = nonNoneOutcomes.filter((outcome) => cycleTouchIds.includes(outcome.farm_touch_id));
      const visits = cycleOutcomes.length;
      const cycleLeadTotal = leads.filter((lead) =>
        lead.touch_id ? cycleTouchIds.includes(lead.touch_id) : false
      ).length;
      const cycleContactTotal = contacts.filter((contact) =>
        cycleTouches.some((touch) => {
          const touchDate = touch.effectiveDate ?? touch.created_at;
          if (!touchDate) return false;
          return new Date(contact.created_at).toDateString() === new Date(touchDate).toDateString();
        })
      ).length;
      const coverageCount = new Set(cycleOutcomes.map((outcome) => outcome.farm_address_id)).size;

      return {
        cycleNumber,
        label: `Cycle ${cycleNumber}`,
        visits,
        contacts: Math.max(cycleLeadTotal, cycleContactTotal),
        sessions: cycleTouches.length,
        coverage: totalHomes > 0 ? coverageCount / totalHomes : 0,
      };
    });

  return {
    touches: resolvedTouches,
    currentCycleNumber,
    currentCycleLabel,
    currentCycleTouches,
    currentCycleTouchIds,
    cycleBuckets,
    totalHomes,
    totalVisits,
    totalContacts,
    totalContactRate,
    totalSpendCents,
    costPerContactCents,
    costPerHomeVisitedCents,
    allTimeUniqueVisitedHomes,
    allTimeCoverageRate,
    allSessionCount,
    avgHomesPerSession,
    currentCycleVisits,
    currentCycleContacts,
    currentCycleContactRate,
    currentCycleCoverageCount,
    currentCycleCoverageRate,
    currentCycleSpendCents,
    currentCycleCostPerContactCents,
    currentCycleCostPerHomeVisitedCents,
    currentCycleAvgHomesPerSession,
    monthSpendCents,
    lastActiveAt,
    latestCompletedTouch,
    nextTouchDueAt,
    nextTouchDaysFromNow,
    targetCadenceDays,
    actualCadenceDays,
    cadenceStatus,
    bestSession,
    modeBreakdown,
    penetration,
    outcomeBreakdown,
  };
}
