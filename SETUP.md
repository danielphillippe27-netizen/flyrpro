# Quick Setup Guide for FLYR PRO

## Prerequisites

- Node.js 18+ installed
- A Supabase account (free tier is fine)
- A Stripe account (test mode is fine)

## Step-by-Step Setup

### 1. Clone and Install

```bash
cd /path/to/FLYR-PRO
npm install
```

### 2. Supabase Setup

#### 2.1 Create a New Project
1. Go to https://supabase.com
2. Click "New Project"
3. Choose a name, database password, and region
4. Wait for the project to be created

#### 2.2 Run the Database Schema
1. In your Supabase project, go to the SQL Editor
2. Copy the contents of `supabase/schema.sql`
3. Paste and click "Run"
4. Verify tables were created in the Table Editor

#### 2.3 Create Storage Bucket
1. Go to Storage in the left sidebar
2. Click "Create a new bucket"
3. Name it `qr`
4. Make it **Public**
5. Click "Create bucket"

#### 2.4 Get Your API Keys
1. Go to Settings → API
2. Copy the following:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon/public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ Keep this secret!)

#### 2.5 Enable Email Auth
1. Go to Authentication → Providers
2. Enable "Email" provider
3. Configure email templates if desired (optional)

### 3. Stripe Setup

#### 3.1 Get Your API Keys
1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your "Secret key" → `STRIPE_SECRET_KEY`

#### 3.2 Create a Product and Price
1. Go to Products → Add Product
2. Name: "Pro Plan"
3. Pricing: Recurring, $29/month (or your choice)
4. Click "Save product"
5. Copy the Price ID (starts with `price_`) → You'll need this in step 3.4

#### 3.3 Set Up Webhook (Local Testing)
For local development:
```bash
# Install Stripe CLI
brew install stripe/stripe-brew/stripe  # macOS
# or download from https://stripe.com/docs/stripe-cli

# Login
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET`

#### 3.4 Update Price ID in Code
Open `components/PaywallGuard.tsx` and update line 23:
```typescript
body: JSON.stringify({ priceId: 'price_YOUR_ACTUAL_PRICE_ID' }),
```

#### 3.5 Set Up Webhook (Production)
When deploying:
1. Go to Stripe Dashboard → Developers → Webhooks
2. Click "Add endpoint"
3. URL: `https://your-domain.com/api/stripe/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET` (production)

### 4. Environment Variables

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_BASE_URL=http://localhost:3000
```

### 5. Run the App

```bash
npm run dev
```

Open http://localhost:3000

### 6. Test the Flow

#### 6.1 Sign In
1. Go to http://localhost:3000/login
2. Enter your email
3. Check your email for the magic link
4. Click the link to sign in

#### 6.2 Create a Campaign
1. Click "New Campaign"
2. Name: "Test Campaign"
3. Destination URL: "https://example.com"
4. Click "Create Campaign"

#### 6.3 Add Recipients
1. Create a test CSV file:
```csv
address_line,city,region,postal_code
123 Main St,Springfield,IL,62701
456 Oak Ave,Chicago,IL,60601
789 Pine Rd,Peoria,IL,61602
```
2. Save as `test-recipients.csv`
3. In the campaign, click "Upload CSV"
4. Select your file

#### 6.4 Generate QR Codes
1. Click "Generate QR Codes"
2. Wait for generation to complete
3. Click "View QR" on any recipient to see the QR code

#### 6.5 Test Tracking
1. Copy the QR code URL (right-click → Copy Link)
2. Open in a new tab
3. You should be redirected to your destination URL
4. Back in the campaign, the recipient status should update to "scanned"

#### 6.6 Test Stripe
1. Try to generate more than 100 QR codes (or modify the limit in the code)
2. The paywall modal should appear
3. Click "Upgrade Now"
4. Use Stripe test card: `4242 4242 4242 4242`
5. Expiry: Any future date
6. CVC: Any 3 digits
7. Complete the checkout
8. You should be redirected back to the dashboard
9. Your Pro status should be active (check in Supabase → user_profiles table)

## Troubleshooting

### "No signature" error on Stripe webhook
- Make sure you're running `stripe listen --forward-to localhost:3000/api/stripe/webhook`
- Copy the webhook secret that the CLI prints out

### "Unauthorized" errors
- Check that your Supabase keys are correct in `.env.local`
- Restart the dev server after changing env variables

### QR codes not generating
- Check Supabase Storage → qr bucket exists and is public
- Check browser console and terminal for errors
- Verify `APP_BASE_URL` is set correctly

### Emails not sending
- For development, check the Supabase Authentication → Logs
- You may need to verify your email in Supabase settings
- For production, configure a custom SMTP provider in Supabase

## Next Steps

- Deploy to Vercel: `vercel deploy`
- Set up production Stripe webhook
- Configure custom domain
- Customize email templates in Supabase
- Add more features!

## Need Help?

- Check the main README.md for more details
- Open an issue on GitHub
- Review Supabase docs: https://supabase.com/docs
- Review Stripe docs: https://stripe.com/docs

