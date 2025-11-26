// Farm-specific types

import type { Farm, FarmTouch, FarmLead, FarmLeadSource } from './database';

export { type Farm, type FarmTouch, type FarmLead, type FarmLeadSource };

export interface CreateFarmPayload {
  name: string;
  polygon?: string; // GeoJSON
  start_date: string;
  end_date: string;
  frequency: number;
}

export interface FarmWithDetails extends Farm {
  touches: FarmTouch[];
  leads: FarmLead[];
}

