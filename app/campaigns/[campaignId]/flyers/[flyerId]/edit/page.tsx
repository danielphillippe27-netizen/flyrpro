import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { FlyerEditorService } from '@/lib/services/FlyerEditorService';
import { FlyerEditorClient } from './FlyerEditorClient';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';

interface PageProps {
  params: Promise<{
    campaignId: string;
    flyerId: string;
  }>;
}

export default async function FlyerEditorPage({ params }: PageProps) {
  const resolvedParams = await params;
  const { campaignId, flyerId } = resolvedParams;

  // Verify user has access to this campaign
  const cookieStore = await cookies();
  
  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  
  console.log("SESSION DEBUG:", { user: user?.id, hasSession: !!user });

  if (!user) {
    redirect('/login');
  }

  // Verify campaign ownership
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, owner_id')
    .eq('id', campaignId)
    .single();

  if (!campaign || campaign.owner_id !== user.id) {
    notFound();
  }

  // Fetch or create flyer
  let flyer = await FlyerEditorService.getFlyerById(flyerId);

  if (!flyer) {
    // Create new flyer if it doesn't exist
    try {
      flyer = await FlyerEditorService.createDefaultFlyer(campaignId, 'New Flyer');
    } catch (error) {
      console.error('Failed to create flyer:', error);
      throw new Error('Failed to initialize flyer');
    }
  }

  // Verify flyer belongs to campaign
  if (flyer.campaign_id !== campaignId) {
    notFound();
  }

  return (
    <FlyerEditorClient
      campaignId={campaignId}
      flyerId={flyer.id}
      initialData={flyer.data}
    />
  );
}
