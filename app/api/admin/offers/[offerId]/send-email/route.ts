import { NextRequest, NextResponse } from 'next/server';
import { getPartnerOfferMailerConfigError } from '@/lib/email/partnerOffers';
import {
  PARTNER_OFFER_SELECT,
  type PartnerOfferRow,
  toClientPartnerOffer,
} from '@/lib/offers/partnerOfferRecord';
import { sendOfferEmailForRow } from '@/app/api/admin/offers/_lib/sendOfferEmail';
import { requireOfferAccessApi } from '@/app/api/admin/offers/_lib/access';

type Params = {
  params: Promise<{ offerId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireOfferAccessApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { offerId } = await params;
    if (!offerId) {
      return NextResponse.json({ error: 'Offer id is required' }, { status: 400 });
    }

    const configError = getPartnerOfferMailerConfigError();
    if (configError) {
      let configQuery = auth.admin
        .from('partner_offers')
        .select(PARTNER_OFFER_SELECT)
        .eq('id', offerId);

      if (!auth.isFounder) {
        configQuery = configQuery.eq('created_by', auth.user.id);
      }

      const { data } = await configQuery.maybeSingle();

      return NextResponse.json(
        {
          error: configError,
          offer: data ? toClientPartnerOffer(data as PartnerOfferRow, request.nextUrl.origin) : null,
        },
        { status: 400 }
      );
    }

    let query = auth.admin
      .from('partner_offers')
      .select(PARTNER_OFFER_SELECT)
      .eq('id', offerId);

    if (!auth.isFounder) {
      query = query.eq('created_by', auth.user.id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const result = await sendOfferEmailForRow({
      offer: data as PartnerOfferRow,
      origin: request.nextUrl.origin,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[api/admin/offers/:offerId/send-email] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
