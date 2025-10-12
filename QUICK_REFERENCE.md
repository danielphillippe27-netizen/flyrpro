# FLYR PRO - Quick Reference

## 🚀 Common Commands

```bash
# Development
npm run dev              # Start dev server (http://localhost:3000)
npm run build           # Build for production
npm run start           # Start production server
npm run lint            # Run ESLint

# Stripe CLI (for local webhook testing)
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## 📁 Key Files to Configure

### Before First Run
1. `.env.local` - Add your Supabase and Stripe credentials
2. `components/PaywallGuard.tsx` (line 23) - Update Stripe price ID
3. `supabase/schema.sql` - Run this in Supabase SQL Editor

## 🔑 Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
STRIPE_SECRET_KEY=sk_test_xxx...
STRIPE_WEBHOOK_SECRET=whsec_xxx...
APP_BASE_URL=http://localhost:3000
```

## 🗺️ Important Routes

| Route | Description |
|-------|-------------|
| `/login` | Magic link authentication |
| `/dashboard` | Campaign list |
| `/campaigns/[id]` | Campaign detail |
| `/api/upload-csv` | CSV upload |
| `/api/generate-qrs` | Generate QR codes |
| `/api/open` | QR scan tracking |
| `/api/zip-qrs` | Download ZIP |
| `/api/stripe/checkout` | Stripe checkout |
| `/api/stripe/webhook` | Stripe webhooks |

## 📊 CSV Format

```csv
address_line,city,region,postal_code
123 Main St,Springfield,IL,62701
456 Oak Ave,Chicago,IL,60601
```

## 🔧 Supabase Setup Checklist

- [ ] Create new project
- [ ] Run `supabase/schema.sql` in SQL Editor
- [ ] Create storage bucket "qr" (make it public)
- [ ] Enable Email auth
- [ ] Copy URL and keys to `.env.local`

## 💳 Stripe Setup Checklist

- [ ] Create product and price
- [ ] Copy price ID to `PaywallGuard.tsx`
- [ ] Copy secret key to `.env.local`
- [ ] Run `stripe listen` for local testing
- [ ] Copy webhook secret to `.env.local`
- [ ] For production: Create webhook endpoint

## 📝 Testing Flow

1. **Sign In**
   - Go to `/login`
   - Enter email
   - Check email for magic link
   - Click link to sign in

2. **Create Campaign**
   - Click "New Campaign"
   - Enter name and destination URL
   - Click "Create Campaign"

3. **Add Recipients**
   - Click "Upload CSV"
   - Select `example-recipients.csv`
   - Wait for upload

4. **Generate QR Codes**
   - Click "Generate QR Codes"
   - Wait for generation
   - QR codes stored in Supabase Storage

5. **Test Tracking**
   - Click "View QR" on any recipient
   - Open QR code URL
   - See redirect to destination URL
   - Check status updated to "scanned"

6. **Download QRs**
   - Click "Download All QRs (ZIP)"
   - Get ZIP file with all QR codes

7. **Test Paywall** (Optional)
   - Generate 100+ QR codes
   - See paywall modal
   - Click "Upgrade Now"
   - Use test card: 4242 4242 4242 4242
   - Complete checkout

## 🎨 UI Components Used

```tsx
// Import from shadcn/ui
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

// Custom components
import { NewCampaignDialog } from '@/components/NewCampaignDialog'
import { RecipientsTable } from '@/components/RecipientsTable'
import { StatsHeader } from '@/components/StatsHeader'
import { PaywallGuard } from '@/components/PaywallGuard'
```

## 🔍 Common Issues

### "Unauthorized" errors
- Check Supabase keys in `.env.local`
- Restart dev server after changing env vars

### Emails not sending
- Check Supabase Authentication logs
- Verify email provider settings
- For production: Configure custom SMTP

### QR codes not generating
- Ensure "qr" bucket exists in Supabase Storage
- Make sure bucket is public
- Check `APP_BASE_URL` is correct

### Stripe webhook errors
- Run `stripe listen` in terminal
- Copy webhook secret shown in terminal
- Make sure webhook secret is in `.env.local`

### Build errors
- Run `npm install` to ensure all dependencies
- Check TypeScript errors with `npm run lint`
- Ensure environment variables have placeholder values

## 📦 Database Schema Quick Reference

### campaigns
```sql
id, user_id, name, type, destination_url, created_at
```

### campaign_recipients
```sql
id, campaign_id, address_line, city, region, postal_code, 
status, sent_at, scanned_at, qr_png_url
```

### user_profiles
```sql
user_id, pro_active, stripe_customer_id, created_at
```

## 🔐 Security Notes

- ⚠️ Never commit `.env.local` to Git
- ⚠️ Keep `SUPABASE_SERVICE_ROLE_KEY` secret
- ⚠️ Keep `STRIPE_SECRET_KEY` secret
- ✅ Use Row Level Security (RLS) policies
- ✅ Validate all user inputs with Zod
- ✅ Use middleware for route protection

## 🌐 Deployment

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
# Update APP_BASE_URL to production URL
# Update Stripe webhook URL to production
```

### Environment Variables in Production
Same as local, but update:
- `APP_BASE_URL` → Production URL
- `STRIPE_WEBHOOK_SECRET` → Production webhook secret

## 📞 Support Resources

- [Next.js Docs](https://nextjs.org/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Stripe Docs](https://stripe.com/docs)
- [shadcn/ui Docs](https://ui.shadcn.com)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)

## 🎯 Project Status

✅ All features implemented
✅ Build successful
✅ Production ready
✅ Documentation complete

**You're ready to go! 🚀**

