# Vercel Deployment Guide

## ✅ Step 1: Code Pushed to GitHub
Your code has been successfully pushed to: `https://github.com/danielphillippe27-netizen/flyrpro.git`

## 🚀 Step 2: Connect to Vercel

1. **Go to Vercel Dashboard**
   - Visit https://vercel.com
   - Sign in with your GitHub account

2. **Import Your Project**
   - Click "Add New..." → "Project"
   - Select the `flyrpro` repository from your GitHub account
   - Click "Import"

3. **Configure Project Settings**
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `./` (default)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)

## 🔐 Step 3: Add Environment Variables

In the Vercel project settings, add these environment variables:

### Required Environment Variables:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-webhook-secret
APP_BASE_URL=https://your-app-name.vercel.app
NEXT_PUBLIC_EDITOR_URL=https://your-editor-url.vercel.app
NEXT_PUBLIC_MAPBOX_TOKEN=your-mapbox-token
```

### How to Add:
1. In Vercel project settings, go to **Settings** → **Environment Variables**
2. Add each variable one by one
3. Select **Production**, **Preview**, and **Development** environments
4. Click **Save**

## 🔄 Step 4: Deploy

1. After adding environment variables, Vercel will automatically:
   - Detect your Next.js app
   - Run `npm install`
   - Run `npm run build`
   - Deploy your app

2. **First Deployment**: Vercel will deploy automatically after you import the project

3. **Future Deployments**: Every time you push to the `main` branch, Vercel will automatically deploy

## 🌐 Step 5: Update APP_BASE_URL

After your first deployment:
1. Copy your Vercel deployment URL (e.g., `https://flyrpro.vercel.app`)
2. Go to **Settings** → **Environment Variables**
3. Update `APP_BASE_URL` to your actual Vercel URL
4. Redeploy (or wait for the next push)

## 📝 Step 6: Configure Stripe Webhook (Production)

1. Go to Stripe Dashboard → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: `https://your-app-name.vercel.app/api/stripe/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the webhook signing secret
6. Update `STRIPE_WEBHOOK_SECRET` in Vercel environment variables

## ✅ Verification

After deployment, verify:
- [ ] App loads at your Vercel URL
- [ ] Authentication works (Supabase)
- [ ] API routes are accessible
- [ ] Stripe webhooks are configured
- [ ] Environment variables are set correctly

## 🔗 Useful Links

- **Vercel Dashboard**: https://vercel.com/dashboard
- **Project Repository**: https://github.com/danielphillippe27-netizen/flyrpro
- **Vercel Docs**: https://vercel.com/docs

## 🚨 Troubleshooting

### Build Fails
- Check build logs in Vercel dashboard
- Verify all environment variables are set
- Ensure `package.json` has correct build script

### Environment Variables Not Working
- Make sure variables are added to all environments (Production, Preview, Development)
- Redeploy after adding new variables
- Check variable names match exactly (case-sensitive)

### API Routes Not Working
- Verify `APP_BASE_URL` is set to your Vercel URL
- Check CORS settings if needed
- Review API route logs in Vercel dashboard


