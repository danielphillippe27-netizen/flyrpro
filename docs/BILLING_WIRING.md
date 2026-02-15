# Billing & Entitlements — Wiring Guide

Steps to turn on Stripe subscriptions and (optionally) Apple IAP verification.

---

## 1. Supabase: run migration

Create the `entitlements` table and RLS:

```bash
# If you use Supabase CLI and linked project:
supabase db push

# Or run the migration manually in SQL Editor (Dashboard → SQL Editor):
# Paste and run: supabase/migrations/20260215000000_create_entitlements.sql
```

Existing Pro users (from `user_profiles.pro_active` or `stripe_customer_id`) are backfilled into `entitlements` by the migration.

---

## 2. Environment variables

Add to `.env.local` (or your host’s env, e.g. Vercel).

### Required for Stripe (web)

| Variable | Where to get it | Notes |
|----------|------------------|--------|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys | Use test key for dev |
| `STRIPE_WEBHOOK_SECRET` | After creating webhook (step 3) | **Required** or webhook returns 400 |
| `STRIPE_PRICE_PRO_MONTHLY` | Stripe Dashboard → Products → your Pro product → price id (e.g. `price_xxx`) | Used for “Upgrade to Pro” |
| `STRIPE_PRICE_PRO_YEARLY` | Same product, yearly price | Optional; add to allowlist if you offer it |
| `NEXT_PUBLIC_APP_URL` | Your app URL | e.g. `https://flyrpro.app` or `http://localhost:3000` |

You already have (or should have):

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 3. Stripe Dashboard: webhook

1. **Developers → Webhooks → Add endpoint**
2. **Endpoint URL**:  
   `https://your-domain.com/api/billing/stripe/webhook`  
   (for local testing use Stripe CLI; see below)
3. **Events to send**:  
   - `checkout.session.completed`  
   - `customer.subscription.created`  
   - `customer.subscription.updated`  
   - `customer.subscription.deleted`  
   - `invoice.paid` (optional)
4. **Create** → copy the **Signing secret** (starts with `whsec_`) and set it as `STRIPE_WEBHOOK_SECRET` in `.env.local`.

**Local testing:**  
Use [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward events:

```bash
stripe listen --forward-to localhost:3000/api/billing/stripe/webhook
```

Use the printed `whsec_...` as `STRIPE_WEBHOOK_SECRET` in `.env.local` for that run.

---

## 4. Stripe: products and prices

1. In Stripe Dashboard, create a **Product** (e.g. “FLYR Pro”).
2. Add at least one **Price** (e.g. monthly recurring), copy the **Price ID** (e.g. `price_1ABC...`).
3. Set in env:
   - `STRIPE_PRICE_PRO_MONTHLY=price_xxxx` (and optionally `STRIPE_PRICE_PRO_YEARLY=price_yyyy`).

Only price IDs listed in env are accepted by `/api/billing/stripe/checkout`.

---

## 5. (Optional) Point old Stripe webhook to new route

If you already have a webhook pointing at `/api/stripe/webhook`:

- Either **switch** the Stripe webhook URL to  
  `https://your-domain.com/api/billing/stripe/webhook`  
  and use the new signing secret for `STRIPE_WEBHOOK_SECRET`,  
- Or leave the old URL and add a second webhook for the new URL; both can run (old one still updates `user_profiles`; new one updates `entitlements`). Prefer a single webhook on the new route long term.

---

## 6. (Optional) Apple IAP — only if you use iOS subscriptions

Set these only when you want to verify Apple purchases:

| Variable | Where to get it |
|----------|------------------|
| `APPLE_BUNDLE_ID` | Your iOS app bundle ID (e.g. `com.flyrpro.app`) |
| `APPLE_APP_STORE_SERVER_ISSUER_ID` | App Store Connect → Users and Access → Keys → App Store Connect API |
| `APPLE_APP_STORE_SERVER_KEY_ID` | Same page, the key’s Key ID |
| `APPLE_APP_STORE_SERVER_PRIVATE_KEY` | .p8 file contents (single line with `\n` for newlines, or literal newlines) |
| `APPLE_ENVIRONMENT` | `Sandbox` (TestFlight / dev) or `Production` (live) |
| `APPLE_PRO_PRODUCT_IDS` | Comma-separated product IDs (e.g. `pro_monthly,pro_yearly`) from App Store Connect |

Without these, the web app and Stripe still work; only `POST /api/billing/apple/verify` will fail until they’re set.

---

## 7. Quick checklist

- [ ] Migration `20260215000000_create_entitlements.sql` applied in Supabase
- [ ] `.env.local`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `NEXT_PUBLIC_APP_URL`
- [ ] Stripe webhook created with URL `.../api/billing/stripe/webhook` and events listed above
- [ ] Stripe product/price created and price ID set in env
- [ ] (Optional) Apple env vars set if you use iOS IAP

After that, open **Settings** or **/billing** in the app: plan comes from entitlements, “Upgrade to Pro” starts Stripe Checkout, “Manage billing” opens the Stripe Customer Portal.
