# FLYR PRO - Direct Mail Campaign Management

A Next.js 15 application for managing direct mail campaigns with QR code tracking, built with Supabase and Stripe.

**FORCE DEPLOY: $(date)**

## Features

- 🔐 Magic link authentication via Supabase
- 📊 Campaign management with recipient tracking
- 🎯 QR code generation for tracking
- 📈 Real-time open rate analytics
- 💳 Pro subscription via Stripe
- 📦 Bulk operations (CSV upload, ZIP download)
- 🔒 Paywall system (100 free QR codes/month)

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **Database**: Supabase (PostgreSQL + Auth + Storage)
- **Payments**: Stripe (Checkout + Webhooks)
- **QR Generation**: qrcode
- **CSV Parsing**: csv-parse
- **ZIP Creation**: jszip

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Copy the environment variables template and fill in your credentials:

```bash
cp .env.example .env.local
```

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (keep secret!)
- `STRIPE_SECRET_KEY`: Your Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Your Stripe webhook signing secret
- `APP_BASE_URL`: Your app URL (http://localhost:3000 for development)
- `NEXT_PUBLIC_EDITOR_URL`: URL of your deployed Canva clone editor (e.g., `https://flyr-editor-yourname.vercel.app`)

### HubSpot OAuth

If you are using the HubSpot integration, configure these server env vars as well:

- `HUBSPOT_OAUTH_CLIENT_ID`: HubSpot OAuth app client ID
- `HUBSPOT_OAUTH_CLIENT_SECRET`: HubSpot OAuth app client secret
- `OAUTH_STATE_SECRET` or `CRM_ENCRYPTION_KEY`: secret used to sign OAuth `state`
- `HUBSPOT_OAUTH_SCOPE`: optional space-separated scopes override

The default HubSpot scope set includes:

- `oauth`
- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- `crm.objects.appointments.read`
- `crm.objects.appointments.write`
- `crm.schemas.appointments.read`
- `crm.schemas.appointments.write`

FLYR creates HubSpot appointments with the `appointments` CRM object, then adds the appointment details as a contact timeline note. This avoids relying on older non-searchable meeting scope names in the OAuth install URL.

If HubSpot shows a scope-mismatch error during connect, make sure the scopes enabled in the HubSpot developer app match `HUBSPOT_OAUTH_SCOPE`. If you already set `HUBSPOT_OAUTH_SCOPE` in production, update that env var directly because the code default is only used when the env var is unset.

### 3. Set Up Supabase

1. Create a new Supabase project
2. Run the SQL schema from `supabase/schema.sql` in the SQL Editor
3. Create a storage bucket named "qr" with public access
4. Enable Email Auth in Authentication settings

### 4. Set Up Stripe

1. Create a Stripe account
2. Create a product and price (e.g., "Pro Plan" at $29/month)
3. Note the price ID (starts with `price_`)
4. Update the price ID in `components/PaywallGuard.tsx` (line 23)
5. Set up a webhook endpoint pointing to `/api/stripe/webhook`
6. Subscribe to these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Usage

### Authentication

1. Navigate to `/login`
2. Enter your email
3. Check your email for the magic link
4. Click the link to sign in

### Creating a Campaign

1. Click "New Campaign" on the dashboard
2. Enter campaign name and destination URL
3. Campaign is created and ready for recipients

### Adding Recipients

1. Open a campaign
2. Click "Upload CSV"
3. Select a CSV file with these columns:
   - `address_line`: Street address
   - `city`: City name
   - `region`: State/province
   - `postal_code`: ZIP/postal code

### Generating QR Codes

1. After uploading recipients, click "Generate QR Codes"
2. QR codes are created and stored in Supabase Storage
3. Each QR code links to `/api/open?id={recipientId}`
4. Free users: 100 QR codes/month limit
5. Pro users: Unlimited QR codes

### Tracking Opens

1. When a recipient scans the QR code, they're redirected to your destination URL
2. The scan is tracked and status updates to "scanned"
3. View open rates on the campaign page

### Downloading QR Codes

1. Click "Download All QRs (ZIP)" to get all QR codes in a ZIP file
2. Each file is named with the recipient's address

### Upgrading to Pro

1. When you hit the 100 QR code limit, a paywall appears
2. Click "Upgrade Now" to proceed to Stripe Checkout
3. After payment, your account is upgraded to Pro
4. Enjoy unlimited QR code generation

## File Structure

```
FLYR-PRO/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   │   └── page.tsx          # Magic link login
│   │   └── layout.tsx
│   ├── (dashboard)/
│   │   ├── dashboard/
│   │   │   └── page.tsx          # Campaign list
│   │   └── layout.tsx
│   ├── campaigns/
│   │   └── [id]/
│   │       └── page.tsx          # Campaign detail
│   ├── api/
│   │   ├── upload-csv/
│   │   │   └── route.ts          # CSV upload endpoint
│   │   ├── generate-qrs/
│   │   │   └── route.ts          # QR generation endpoint
│   │   ├── open/
│   │   │   └── route.ts          # QR scan tracking
│   │   ├── zip-qrs/
│   │   │   └── route.ts          # ZIP download endpoint
│   │   └── stripe/
│   │       ├── checkout/
│   │       │   └── route.ts      # Stripe Checkout
│   │       └── webhook/
│   │           └── route.ts      # Stripe webhooks
│   ├── thank-you/
│   │   └── page.tsx              # Fallback page
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Home (redirects to dashboard)
│   └── globals.css
├── components/
│   ├── ui/                       # shadcn components
│   ├── NewCampaignDialog.tsx     # Create campaign modal
│   ├── RecipientsTable.tsx       # Recipients list
│   ├── StatsHeader.tsx           # Campaign stats
│   └── PaywallGuard.tsx          # Upgrade modal
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client
│   │   └── server.ts             # Server Supabase client
│   ├── stripe.ts                 # Stripe client
│   └── utils.ts                  # Utility functions
├── supabase/
│   └── schema.sql                # Database schema
├── middleware.ts                 # Auth middleware
└── package.json
```

## Database Schema

### campaigns
- `id`: UUID (primary key)
- `user_id`: UUID (references auth.users)
- `name`: Text
- `type`: Text (letters/flyers)
- `destination_url`: Text
- `created_at`: Timestamp

### campaign_recipients
- `id`: UUID (primary key)
- `campaign_id`: UUID (references campaigns)
- `address_line`: Text
- `city`: Text
- `region`: Text
- `postal_code`: Text
- `status`: Text (pending/sent/scanned)
- `sent_at`: Timestamp
- `scanned_at`: Timestamp
- `qr_png_url`: Text

### user_profiles
- `user_id`: UUID (primary key, references auth.users)
- `pro_active`: Boolean
- `stripe_customer_id`: Text
- `created_at`: Timestamp

## API Endpoints

### POST /api/upload-csv?campaignId={id}
Upload CSV file with recipients. Validates and inserts into database.

### POST /api/generate-qrs?campaignId={id}
Generate QR codes for all recipients without QR codes. Enforces 100/month limit for free users.

### GET /api/open?id={recipientId}
Track QR code scan and redirect to campaign destination URL.

### GET /api/zip-qrs?campaignId={id}
Download all QR codes for a campaign as a ZIP file.

### POST /api/stripe/checkout
Create Stripe Checkout session. Body: `{ priceId: "price_xxx" }`

### POST /api/stripe/webhook
Handle Stripe webhook events. Updates user Pro status based on subscription state.

## Development Tips

### Testing Stripe Webhooks Locally

Use the Stripe CLI to forward webhooks to your local server:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the webhook signing secret and add it to `.env.local`.

### Creating Test Data

1. Sign in with your email
2. Create a test campaign
3. Upload a CSV with test addresses
4. Generate QR codes
5. Visit the QR code URLs to test tracking

### CSV Format Example

```csv
address_line,city,region,postal_code
123 Main St,Springfield,IL,62701
456 Oak Ave,Chicago,IL,60601
789 Pine Rd,Peoria,IL,61602
```

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the project in Vercel
3. Add environment variables in Vercel project settings
4. Deploy
5. Update `APP_BASE_URL` to your production URL
6. Update Stripe webhook endpoint to your production URL

### Other Platforms

Ensure your platform supports:
- Node.js 18+
- Environment variables
- Serverless functions

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
# FLYR PRO - Sun Oct 12 00:42:14 EDT 2025
