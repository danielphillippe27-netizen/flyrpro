import type { Farm, FarmGoalType, FarmTouchInterval, FarmTouchType } from '@/types/database';

export const FARM_TOUCH_INTERVAL_OPTIONS: Array<{ value: FarmTouchInterval; label: string }> = [
  { value: 'month', label: 'Per month' },
  { value: 'year', label: 'Per year' },
];

export const FARM_TOUCH_TYPE_OPTIONS: Array<{ value: FarmTouchType; label: string }> = [
  { value: 'doorknock', label: 'Doorknock' },
  { value: 'flyer', label: 'Flyer' },
  { value: 'canada_post', label: 'Canada Post' },
  { value: 'pop_by', label: 'Pop by' },
  { value: 'letter', label: 'Letter' },
];

export const FARM_GOAL_TYPE_OPTIONS: Array<{ value: FarmGoalType; label: string }> = [
  { value: 'homes_per_cycle', label: 'Homes per cycle' },
  { value: 'touches_per_cycle', label: 'Sessions per cycle' },
  { value: 'touches_per_year', label: 'Sessions per year' },
];

const TOUCH_TYPE_LABELS: Record<FarmTouchType, string> = Object.fromEntries(
  FARM_TOUCH_TYPE_OPTIONS.map((option) => [option.value, option.label])
) as Record<FarmTouchType, string>;

const GOAL_TYPE_LABELS: Record<FarmGoalType, string> = Object.fromEntries(
  FARM_GOAL_TYPE_OPTIONS.map((option) => [option.value, option.label])
) as Record<FarmGoalType, string>;

const TOUCH_TYPE_VALUES = new Set<FarmTouchType>(FARM_TOUCH_TYPE_OPTIONS.map((option) => option.value));

export function normalizeFarmTouchTypes(value?: string[] | null): FarmTouchType[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((type) => {
      if (type === 'mail') return 'letter';
      if (type === 'event') return 'pop_by';
      return type;
    })
    .filter((type): type is FarmTouchType => TOUCH_TYPE_VALUES.has(type as FarmTouchType));
}

export function formatFarmTouchTypeLabel(type: FarmTouchType): string {
  return TOUCH_TYPE_LABELS[type];
}

export function getFarmGoalType(
  farm: Pick<Farm, 'goal_type' | 'touches_interval'>
): FarmGoalType {
  if (farm.goal_type) return farm.goal_type;
  return 'homes_per_cycle';
}

export function getFarmGoalTarget(
  farm: Pick<Farm, 'goal_target' | 'touches_per_interval' | 'frequency'>
): number {
  return Math.max(1, farm.goal_target ?? farm.touches_per_interval ?? farm.frequency ?? 1);
}

export function formatFarmGoalLabel(type: FarmGoalType): string {
  return GOAL_TYPE_LABELS[type];
}

export function formatFarmGoal(
  farm: Pick<Farm, 'goal_type' | 'goal_target' | 'touches_per_interval' | 'touches_interval' | 'frequency'>
): string {
  const type = getFarmGoalType(farm);
  const target = getFarmGoalTarget(farm);
  const noun = type === 'homes_per_cycle' ? 'home' : 'session';
  return `${target} ${target === 1 ? noun : `${noun}s`} / ${type === 'touches_per_year' ? 'year' : 'cycle'}`;
}

export function getFarmTouchCount(farm: Pick<Farm, 'touches_per_interval' | 'frequency'>): number {
  return 1;
}

export function getFarmTouchInterval(
  farm: Pick<Farm, 'touches_interval'>
): FarmTouchInterval {
  return farm.touches_interval === 'year' ? 'year' : 'month';
}

export function formatFarmCadence(
  farm: Pick<Farm, 'touches_per_interval' | 'touches_interval' | 'frequency'>
): string {
  const interval = getFarmTouchInterval(farm);
  return `1 cycle / ${interval}`;
}

export function formatFarmBudget(cents?: number | null): string | null {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return null;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
