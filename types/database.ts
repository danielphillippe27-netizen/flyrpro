export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  type: 'letters' | 'flyers';
  destination_url: string;
  created_at: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  address_line: string;
  city: string;
  region: string;
  postal_code: string;
  status: 'pending' | 'sent' | 'scanned';
  sent_at: string | null;
  scanned_at: string | null;
  qr_png_url: string | null;
}

export interface UserProfile {
  user_id: string;
  pro_active: boolean;
  stripe_customer_id: string | null;
  created_at: string;
}

