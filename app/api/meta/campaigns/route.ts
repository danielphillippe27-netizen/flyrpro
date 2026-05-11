import { NextRequest, NextResponse } from 'next/server';
import { getDecryptedMetaToken, requireMetaUser } from '../_lib/access';
import { listMetaCampaigns, metaErrorResponse } from '../_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireMetaUser(request);
    if (auth instanceof NextResponse) return auth;

    const adAccountId = request.nextUrl.searchParams.get('adAccountId')?.trim();
    if (!adAccountId) {
      return NextResponse.json({ error: 'adAccountId is required' }, { status: 400 });
    }

    const { accessToken } = await getDecryptedMetaToken(auth.admin, auth.user.id);
    const campaigns = await listMetaCampaigns(accessToken, adAccountId);

    return NextResponse.json({
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name ?? 'Untitled Meta campaign',
        status: campaign.status ?? null,
        objective: campaign.objective ?? null,
        start_time: campaign.start_time ?? null,
        stop_time: campaign.stop_time ?? null,
      })),
    });
  } catch (error) {
    const metaError = metaErrorResponse(error);
    return NextResponse.json(
      { error: metaError.message, code: metaError.code },
      { status: metaError.status }
    );
  }
}
