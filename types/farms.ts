// Farm-specific types

import type {
  Farm,
  FarmGoalType,
  FarmTouch,
  FarmLead,
  FarmLeadSource,
  FarmAddress,
  FarmTouchAddress,
  FarmAddressOutcomeStatus,
  FarmSessionMode,
  FarmTouchInterval,
  FarmTouchType,
} from './database';

export {
  type Farm,
  type FarmGoalType,
  type FarmTouch,
  type FarmLead,
  type FarmLeadSource,
  type FarmAddress,
  type FarmTouchAddress,
  type FarmAddressOutcomeStatus,
  type FarmSessionMode,
  type FarmTouchInterval,
  type FarmTouchType,
};

export interface CreateFarmPayload {
  name: string;
  description?: string;
  polygon?: string; // GeoJSON
  start_date: string;
  end_date: string;
  frequency: number;
  touches_per_interval?: number | null;
  touches_interval?: FarmTouchInterval | null;
  goal_type?: FarmGoalType | null;
  goal_target?: number | null;
  cycle_completion_window_days?: number | null;
  touch_types?: FarmTouchType[] | null;
  annual_budget_cents?: number | null;
  workspace_id?: string | null;
  area_label?: string;
  home_limit?: number;
  address_count?: number;
}

export interface FarmWithDetails extends Farm {
  touches: FarmTouch[];
  leads: FarmLead[];
  addresses: FarmAddress[];
}

