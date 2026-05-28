# Ambassador Payout Testing

Use Stripe test mode only. Local env should have:

- `STRIPE_MODE=test`
- `STRIPE_SECRET_KEY_TEST=sk_test_...`
- `STRIPE_WEBHOOK_SECRET_TEST=whsec_...`
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`

## 1. Start The App

```bash
npm run dev
```

## 2. Start Stripe Webhooks

```bash
npm run stripe:listen:test
```

If Stripe prints a new `whsec_...`, put it in `STRIPE_WEBHOOK_SECRET_TEST` in `.env.local`, then restart `npm run dev`.

The listener forwards:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `account.updated`

## 3. Signup Smoke

```bash
npm run test:ambassador-signup
```

This creates a disposable ambassador referral and user, completes onboarding through the real API, verifies referral/trial/profile state, and cleans up.

## 4. Payout Smoke

```bash
npm run test:ambassador-payout
```

This seeds one pending ambassador commission, calls the same payout function used by the admin Pay Now button, verifies `paid` state and Stripe transfer id, then cleans up local DB rows.

For this local Canadian Stripe test account, `.env.local` can set:

```bash
STRIPE_TEST_CONNECT_ACCOUNT_ID=acct_...
SMOKE_PAYOUT_CURRENCY=CAD
```

The payout smoke seeds CAD test availability with Stripe's `pm_card_bypassPending` test payment method when needed. If Stripe still says available balance is too low, inspect test balance in Stripe Dashboard under Balances.

By default the payout smoke creates a disposable US connected account and tests a USD transfer. To test another currency, provide a connected account that can receive that currency:

```bash
STRIPE_TEST_CONNECT_ACCOUNT_ID=acct_... SMOKE_PAYOUT_CURRENCY=CAD npm run test:ambassador-payout
```
