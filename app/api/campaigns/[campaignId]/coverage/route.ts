import { NextRequest, NextResponse } from 'next/server';
import { requestSupabase } from '@/app/api/_utils/request-supabase';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const client = await requestSupabase(request);
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await client.rpc('get_campaign_workspace_coverage', { p_campaign_id: campaignId });
  if (error) return NextResponse.json({ error: 'Shared coverage could not be loaded' }, { status: error.code === '42501' ? 403 : 503 });
  return NextResponse.json(data);
}
