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
      return {
        referralCode: trimmed,
        source: 'coupon',
        stripeCouponId: coupon.id,
        discounts: [{ coupon: coupon.id }],
        percentOff: coupon.percent_off ?? null,
        amountOff: coupon.amount_off ?? null,
        amountOffCurrency: coupon.currency?.toUpperCase() ?? null,
        duration: coupon.duration ?? null,
      };
    }
  } catch {
    // Ignore invalid coupon IDs.
  }

  return null;
}
