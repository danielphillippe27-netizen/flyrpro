import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { getPartnerOfferMailerConfigError } from '@/lib/email/partnerOffers';
import {
  PARTNER_OFFER_SELECT,
  type PartnerOfferRow,
  toClientPartnerOffer,
} from '@/lib/offers/partnerOfferRecord';
import { sendOfferEmailForRow } from '@/app/api/admin/offers/_lib/sendOfferEmail';

type Params = {
  params: Promise<{ offerId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { offerId } = await params;
    if (!offerId) {
      return NextResponse.json({ error: 'Offer id is required' }, { status: 400 });
    }

    const configError = getPartnerOfferMailerConfigError();
    if (configError) {
      const { data } = await auth.admin
        .from('partner_offers')
        .select(PARTNER_OFFER_SELECT)
        .eq('id', offerId)
        .maybeSingle();

      return NextResponse.json(
        {
          error: configError,
          offer: data ? toClientPartnerOffer(data as PartnerOfferRow, request.nextUrl.origin) : null,
        },
        { status: 400 }
      );
    }

    const { data, error } = await auth.admin
      .from('partner_offers')
      .select(PARTNER_OFFER_SELECT)
      .eq('id', offerId)
      .maybeSingle();

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
