import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedFarm } from '@/app/api/meta/_lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ farmId: string; linkId: string }> }
) {
  try {
    const { farmId, linkId } = await context.params;
    const authorized = await requireAuthorizedFarm(request, farmId);
    if (authorized instanceof NextResponse) return authorized;

    const { error } = await authorized.admin
      .from('farm_meta_campaign_links')
      .update({
        status: 'unlinked',
        updated_at: new Date().toISOString(),
      })
      .eq('id', linkId)
      .eq('farm_id', authorized.farm.id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ unlinked: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to unlink Meta campaign.' },
      { status: 500 }
    );
  }
}
