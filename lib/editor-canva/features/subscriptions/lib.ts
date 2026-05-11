const DAY_IN_MS = 86_400_000;

type Subscription = {
  priceId?: string | null;
  currentPeriodEnd?: Date | null;
} | null;

export const checkIsActive = (
  subscription: Subscription,
) => {
  let active = false;

  if (
    subscription &&
    subscription.priceId &&
    subscription.currentPeriodEnd
  ) {
    active = subscription.currentPeriodEnd.getTime() + DAY_IN_MS > Date.now();
  }

  return active;
};
