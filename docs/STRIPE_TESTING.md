# Testing Stripe locally

Use **test mode** so no real charges happen. Follow these steps.

---

## 1. Use test keys and test data

In [Stripe Dashboard](https://dashboard.stripe.com), switch to **Test mode** (toggle top-right).

- **API keys**: Developers → API keys → use **Secret key** that starts with `sk_test_...`.
- **Product & price**: Create a product (e.g. "FLYR Pro") and a recurring price in test mode. Copy the **Price ID** (e.g. `price_1ABC...`).

In `.env.local`:

```bash
# Test secret key (sk_test_...)
STRIPE_SECRET_KEY=sk_test_...

# Price ID from your test product (price_...)
STRIPE_PRICE_PRO_MONTHLY=price_...

# For local dev
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Optional (for pricing page): set `STRIPE_PRICE_USD_MONTHLY`, `STRIPE_PRICE_USD_YEARLY`, `STRIPE_PRICE_CAD_*` to test price IDs if you use them.

---

## 2. Forward webhooks to localhost

Stripe can’t reach `localhost`, so use the Stripe CLI to forward events.

**Install Stripe CLI** (if needed):  
https://stripe.com/docs/stripe-cli#install

Then:

```bash
# From project root
stripe listen --forward-to localhost:3000/api/billing/stripe/webhook
```

The CLI prints a **webhook signing secret** like `whsec_...`. Copy it and add to `.env.local`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

Restart your Next.js app after changing `.env.local` so it picks up the new secret.

---

## 3. Run the app and Stripe listener

Use two terminals:

**Terminal 1 – Next.js**

```bash
npm run dev
```

**Terminal 2 – Stripe webhooks**

```bash
npm run stripe:listen
```

If your app runs on a different port (e.g. 3001), use:

```bash
stripe listen --forward-to localhost:3001/api/billing/stripe/webhook
```

Keep both running while testing checkout.

---

## 4. Run a test checkout

1. Open **http://localhost:3000** and sign in.
2. Go to **Settings** → **Billing**, or open **http://localhost:3000/pricing**.
3. Click **Upgrade to Pro** (or a specific plan on the pricing page).
4. On the Stripe Checkout page, use a [test card](https://stripe.com/docs/testing#cards):
   - **Success**: `4242 4242 4242 4242`
   - **Decline**: `4000 0000 0000 0002`
   - **3D Secure**: `4000 0025 0000 3155`
   - Use any future expiry (e.g. `12/34`), any 3-digit CVC, any postal code.
5. Complete payment. You should be redirected to `/billing/success?session_id=...`. The success page calls `/api/billing/stripe/confirm-session` to sync your entitlement immediately (so Pro shows even if the webhook hasn’t run yet). Then go to `/billing` to see **Pro**.

---

## 5. Verify

- **Success page** (`/billing/success`): Shows “Activating your subscription…” then “Thank you” and a link to Billing.
- **Billing page** (`/billing`): Plan shows **Pro**, “Manage billing” opens Stripe Customer Portal.
- **Stripe CLI**: You should see `checkout.session.completed` and `customer.subscription.created` (or similar) in the terminal.
- **Stripe Dashboard** (test mode): Customers and Subscriptions show the test customer and subscription.

The success page uses `POST /api/billing/stripe/confirm-session` to sync the entitlement as soon as you land, so you don’t have to wait for the webhook. The webhook still runs and keeps entitlements in sync for renewals and cancellations.

---

## Quick checklist

- [ ] Stripe Dashboard in **Test mode**
- [ ] `STRIPE_SECRET_KEY=sk_test_...` in `.env.local`
- [ ] `STRIPE_PRICE_PRO_MONTHLY=price_...` (test price ID) in `.env.local`
- [ ] `NEXT_PUBLIC_APP_URL=http://localhost:3000` in `.env.local`
- [ ] Stripe CLI running: `stripe listen --forward-to localhost:3000/api/billing/stripe/webhook`
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_...` from CLI output in `.env.local`
- [ ] Next.js restarted after env changes
- [ ] Entitlements migration applied in Supabase (see [BILLING_WIRING.md](./BILLING_WIRING.md))

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| "Valid price ID required" | Price ID in env must match a test mode price and be in the allowlist in `stripe-products.ts`. |
| Webhook returns 400 | `STRIPE_WEBHOOK_SECRET` must be the one from `stripe listen` when testing locally. |
| Plan stays Free after paying | Webhook not reaching app or secret wrong; check Stripe CLI for events and app logs. |
| "No subscription to manage" | User has no Stripe customer yet; complete at least one checkout first. |
