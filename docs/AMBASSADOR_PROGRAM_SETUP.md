# FLYR Ambassador Program Setup

## Recommended program structure

- Base lane: `20%` recurring commission for `12 months`
- Audience offer: `30-day free trial`
- Milestone bonuses: cash bonuses at `10`, `25`, and `50` paid users
- Top partner lane: paid content + `25%-30%` recurring + category exclusivity when justified

## What the homepage flow now does

- Public homepage includes an `Ambassador Program` nav link and application section
- Applications submit into `public.ambassador_applications`
- Founder can generate a Stripe Connect Express onboarding link for an approved application

## Stripe payout setup

Use Stripe Connect Express for approved ambassadors.

Why this is the right fit:

- ambassadors can onboard themselves
- Stripe handles tax and payout onboarding details
- FLYR can keep subscription billing on the platform account
- monthly commissions can be sent to connected accounts after you calculate what each ambassador earned

## Suggested payout flow

1. Creator applies on the homepage.
2. Founder reviews the application and approves the creator.
3. Founder calls `POST /api/admin/ambassadors/:applicationId/stripe-connect`.
4. FLYR emails the returned `onboardingUrl` to the creator when email is configured, and copies it for the founder as a manual fallback.
5. After the creator finishes onboarding, Stripe marks the connected account ready for payouts.
6. Each month, FLYR calculates earned commission and sends transfers to approved connected accounts.

## Data you should track next

- ambassador referral code
- Stripe promotion code or coupon mapping
- clicks
- trials started
- paid conversions
- monthly recurring revenue tied to the ambassador
- commission due per payout period
- payout sent date and Stripe transfer id

## Good next implementation step

Add an internal founder view that lists applications, lets you approve/reject them, and shows a one-click `Create Stripe onboarding link` action.
