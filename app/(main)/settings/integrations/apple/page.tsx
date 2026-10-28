import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import AppleIntegrationDashboard from '@/components/apple/AppleIntegrationDashboard';
export const dynamic='force-dynamic';
export default async function AppleIntegrationsPage(){const api=await getSupabaseServerClient();const {data:{user}}=await api.auth.getUser();if(!user)redirect('/login?next=/settings/integrations/apple');return <AppleIntegrationDashboard/>;}
