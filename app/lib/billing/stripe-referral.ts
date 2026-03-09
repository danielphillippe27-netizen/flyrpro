import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';

export type ResolvedReferralDiscount = {
  referralCode: string;
  source: 'promotion_code' | 'coupon';
  stripePromotionCodeId?: string;
  stripeCouponId?: string;
  discounts: Stripe.Checkout.SessionCreateParams.Discount[];
  percentOff: number | null;
  amountOff: number | null;
  amountOffCurrency: string | null;
  duration: Stripe.Coupon.Duration | null;
};

function buildCouponDiscount(
  referralCode: string,
  coupon: Stripe.Coupon
): ResolvedReferralDiscount {
  return {
    referralCode,
    source: 'coupon',
    stripeCouponId: coupon.id,
    discounts: [{ coupon: coupon.id }],
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off ?? null,
    amountOffCurrency: coupon.currency?.toUpperCase() ?? null,
    duration: coupon.duration ?? null,
  };
}

async function findCouponByName(input: string): Promise<Stripe.Coupon | null> {
  const normalizedInput = input.trim().toLowerCase();
  if (!normalizedInput) return null;

  let startingAfter: string | undefined;
  // Scan a bounded number of pages to support coupon-name referral codes.
  for (let page = 0; page < 5; page += 1) {
    const results = await stripe.coupons.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const match = results.data.find((coupon) => {
      const couponName = coupon.name?.trim().toLowerCase();
      return (
        coupon.valid &&
        (couponName === normalizedInput || coupon.id.trim().toLowerCase() === normalizedInput)
      );
    });
    if (match) return match;

    if (!results.has_more || results.data.length === 0) break;
    startingAfter = results.data[results.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  return null;
}

export async function resolveReferralDiscount(
  referralCode: string | null
): Promise<ResolvedReferralDiscount | null> {
  const trimmed = typeof referralCode === 'string' ? referralCode.trim() : '';
  if (!trimmed) return null;

  try {
    const promoResults = await stripe.promotionCodes.list({
      code: trimmed,
      active: true,
      limit: 1,
    });
    const promo = promoResults.data[0] as
      | (Stripe.PromotionCode & { promotion?: { type?: string; coupon?: string } })
      | undefined;
    if (promo?.id) {
      const couponId =
        promo.promotion?.type === 'coupon' && typeof promo.promotion.coupon === 'string'
          ? promo.promotion.coupon
          : undefined;
      let coupon: Stripe.Coupon | null = null;
      if (couponId) {
        try {
          const fetched = await stripe.coupons.retrieve(couponId);
          coupon = 'deleted' in fetched ? null : fetched;
        } catch {
          coupon = null;
        }
      }
      return {
        referralCode: trimmed,
        source: 'promotion_code',
        stripePromotionCodeId: promo.id,
        stripeCouponId: coupon?.id ?? couponId,
        discounts: [{ promotion_code: promo.id }],
        percentOff: coupon?.percent_off ?? null,
        amountOff: coupon?.amount_off ?? null,
        amountOffCurrency: coupon?.currency?.toUpperCase() ?? null,
        duration: coupon?.duration ?? null,
      };
    }
  } catch (error) {
    console.warn('[Stripe] Failed to resolve promotion code from referral:', error);
  }

  try {
    const coupon = await stripe.coupons.retrieve(trimmed);
    if (!('deleted' in coupon) && coupon.valid) {
      return buildCouponDiscount(trimmed, coupon);
    }
  } catch {
    // Ignore invalid coupon IDs.
  }

  try {
    const coupon = await findCouponByName(trimmed);
    if (coupon) {
      return buildCouponDiscount(trimmed, coupon);
    }
  } catch (error) {
    console.warn('[Stripe] Failed to resolve coupon from referral name:', error);
  }

  return null;
}
