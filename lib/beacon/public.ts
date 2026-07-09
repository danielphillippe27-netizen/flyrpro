import { createAdminClient } from '@/lib/supabase/server';

export type BeaconBreadcrumb = {
  lat: number;
  lon: number;
  battery_level?: number | null;
  movement_state?: string | null;
  recorded_at: string;
};

export type BeaconSafetyEvent = {
  id: string;
  event_type: string;
  message?: string | null;
  lat?: number | null;
  lon?: number | null;
  created_at: string;
};

export type BeaconSession = {
  id: string;
  start_time: string;
  end_time?: string | null;
  goal_type?: string | null;
  goal_amount?: number | null;
  completed_count?: number | null;
  flyers_delivered?: number | null;
  conversations?: number | null;
  distance_meters?: number | null;
  is_paused?: boolean | null;
};

export type BeaconHeartbeat = {
  lat: number;
  lon: number;
  battery_level?: number | null;
  movement_state?: string | null;
  device_status?: Record<string, unknown> | null;
  recorded_at: string;
};

export type BeaconSessionDoor = {
  address_id: string;
  formatted?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  lat: number;
  lon: number;
  status?: string | null;
  map_status?: string | null;
  feature_type?: string | null;
  source?: string | null;
  address_provenance?: string | null;
  event_type?: string | null;
  created_at: string;
};

export type PublicBeaconPayload = {
  active: boolean;
  reason?: string;
  share?: {
    id: string;
    viewer_label?: string | null;
    created_at: string;
    check_in_interval_minutes?: number | null;
    last_viewed_at?: string | null;
  };
  session?: BeaconSession | null;
  latest_heartbeat?: BeaconHeartbeat | null;
  breadcrumbs?: BeaconBreadcrumb[];
  safety_events?: BeaconSafetyEvent[];
  session_doors?: BeaconSessionDoor[];
};

export async function getPublicBeaconByToken(token: string): Promise<PublicBeaconPayload> {
  const admin = createAdminClient();
  const cleanedToken = token.trim();

  if (!cleanedToken) {
    return { active: false, reason: 'missing_token' };
  }

  const { data, error } = await admin.rpc('rpc_get_public_session_beacon', {
    p_share_token: cleanedToken,
  });

  if (error) {
    console.error('Beacon RPC failed:', error);
    return { active: false, reason: 'lookup_failed' };
  }

  return (data ?? { active: false, reason: 'expired' }) as PublicBeaconPayload;
}
