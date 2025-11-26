// Contact-specific types

import type { Contact, ContactActivity, ContactStatus, ActivityType } from './database';

export { type Contact, type ContactActivity, type ContactStatus, type ActivityType };

export interface CreateContactPayload {
  full_name: string;
  phone?: string;
  email?: string;
  address: string;
  campaign_id?: string;
  farm_id?: string;
  status: ContactStatus;
}

export interface ContactWithActivities extends Contact {
  activities: ContactActivity[];
}

