import { NextRequest, NextResponse } from 'next/server';
import { requireOfferAccessApi } from '@/app/api/admin/offers/_lib/access';

type Params = {
  params: Promise<{ offerId: string }>;
};

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const auth = await requireOfferAccessApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { offerId } = await params;
    if (!offerId) {
      return NextResponse.json({ error: 'Offer id is required' }, { status: 400 });
    }

    let query = auth.admin
      .from('partner_offers')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', offerId)
      .is('revoked_at', null)
      .select('id');

    if (!auth.isFounder) {
      query = query.eq('created_by', auth.user.id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Offer not found or already revoked' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/admin/offers/:offerId/revoke] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
