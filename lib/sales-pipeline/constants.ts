import type {
  SalesPipelinePriority,
  SalesPipelineStage,
  SalesPipelineTaskType,
} from '@/types/database';

export const SALES_SEAT_MONTHLY_VALUE_CENTS = 4000;

export const PIPELINE_STAGES: Array<{ value: SalesPipelineStage; label: string }> = [
  { value: 'new_lead', label: 'New Lead' },
  { value: 'attempting_contact', label: 'Attempting Contact' },
  { value: 'connected', label: 'Connected' },
  { value: 'demo_sent', label: 'Demo Sent' },
  { value: 'trial_sent', label: 'Trial Sent' },
  { value: 'trial_active', label: 'Trial Active' },
  { value: 'closing', label: 'Closing' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'nurture', label: 'Nurture' },
];

export const ACTIVE_PIPELINE_STAGES = new Set<SalesPipelineStage>(
  PIPELINE_STAGES
    .map((stage) => stage.value)
    .filter((stage) => stage !== 'won' && stage !== 'lost' && stage !== 'nurture')
);

export const PIPELINE_PRIORITIES: Array<{ value: SalesPipelinePriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'hot', label: 'Hot' },
];

export const PIPELINE_TASK_TYPES: Array<{ value: SalesPipelineTaskType; label: string }> = [
  { value: 'call', label: 'Call' },
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'dm', label: 'DM' },
  { value: 'demo_follow_up', label: 'Demo follow-up' },
  { value: 'trial_check_in', label: 'Trial check-in' },
  { value: 'close_ask', label: 'Close ask' },
  { value: 'nurture', label: 'Nurture' },
];

export type SalesPipelineFilter =
  | 'all'
  | 'due_today'
  | 'overdue'
  | 'no_next_step'
  | 'trial_follow_up'
  | 'closing';

export const PIPELINE_FILTERS: Array<{ value: SalesPipelineFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'due_today', label: 'Due Today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'no_next_step', label: 'No Next Step' },
  { value: 'trial_follow_up', label: 'Trial Follow-Up' },
  { value: 'closing', label: 'Closing' },
];

export function pipelineStageLabel(value?: string | null): string {
  return PIPELINE_STAGES.find((stage) => stage.value === value)?.label ?? 'New Lead';
}

export function pipelineTaskTypeLabel(value?: string | null): string {
  return PIPELINE_TASK_TYPES.find((type) => type.value === value)?.label ?? 'Pipeline step';
}

export function pipelinePriorityLabel(value?: string | null): string {
  return PIPELINE_PRIORITIES.find((priority) => priority.value === value)?.label ?? 'Normal';
}

export function estimatedMonthlyValueForSeats(seats: number | null | undefined): number {
  return Math.max(1, Math.trunc(Number(seats) || 1)) * SALES_SEAT_MONTHLY_VALUE_CENTS;
}
