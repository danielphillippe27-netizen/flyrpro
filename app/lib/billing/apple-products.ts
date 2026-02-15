/**
 * Allowed Apple product IDs for Pro. Reject any productId not in this list.
 * Team IDs can be added later.
 */
export const APPLE_PRO_PRODUCT_IDS: string[] = (
  process.env.APPLE_PRO_PRODUCT_IDS ?? ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function isAllowedAppleProductId(productId: string): boolean {
  return APPLE_PRO_PRODUCT_IDS.length > 0 && APPLE_PRO_PRODUCT_IDS.includes(productId);
}
