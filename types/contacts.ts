// Contact-specific types

import type { Contact, ContactActivity, ContactStatus, ActivityType } from './database';

export { type Contact, type ContactActivity, type ContactStatus, type ActivityType };

export interface CreateContactPayload {
  first_name: string;
  last_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  campaign_id?: string;
  farm_id?: string;
  status: ContactStatus;
  notes?: string;
  address_id?: string; // Optional: link to campaign_addresses.id
  tags?: string; // Optional comma-separated tags
}

export interface ContactWithActivities extends Contact {
  activities: ContactActivity[];
}

