# Supabase Auth Redirect Configuration

## ✅ Code Changes Complete

The code has been updated to use dynamic redirects based on `window.location.origin`. All auth redirects now go through `/auth/callback` route.

## 🔧 Supabase Dashboard Configuration

To ensure redirects work correctly, you need to configure Supabase to allow your callback URLs:

### Step 1: Update Site URL (Optional but Recommended)

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Go to **Settings** → **Authentication** → **URL Configuration**
4. Set **Site URL** to your production URL:
   - Production: `https://flyrpro.app`
   - (Leave blank or use production URL - this is just a default)

### Step 2: Add Redirect URLs (Required)

1. In the same **URL Configuration** section
2. Under **Redirect URLs**, add these URLs (one per line):

```
https://flyrpro.app/auth/callback
https://flyrpro.app/home
http://localhost:3000/auth/callback
http://localhost:3000/home
```

**Important:** For Vercel preview deployments, Supabase will automatically allow any URL that matches your Site URL pattern. However, you can also add wildcard patterns:

```
https://*.vercel.app/auth/callback
https://*.vercel.app/home
```

### Step 3: Verify Email Templates (Optional)

1. Go to **Authentication** → **Email Templates**
2. Check that magic link emails are using the correct redirect URL
3. The code now sends: `${window.location.origin}/auth/callback?next=/home`
4. This will automatically work for all environments

## 🧪 Testing

### Local Testing
1. Start dev server: `npm run dev`
2. Go to `http://localhost:3000/login`
3. Enter your email
4. Click the magic link in your email
5. Should redirect to: `http://localhost:3000/auth/callback?code=...`
6. Then automatically redirect to: `http://localhost:3000/home`

### Production Testing
1. Go to `https://flyrpro.app/login`
2. Enter your email
3. Click the magic link
4. Should redirect to: `https://flyrpro.app/auth/callback?code=...`
5. Then automatically redirect to: `https://flyrpro.app/home`

## 🔄 Handling Old Magic Links

If you have old magic links that redirect directly to `/home?code=...`, the home page will automatically detect the `code` parameter and redirect to the callback route. This ensures backward compatibility.

## ⚠️ Troubleshooting

### Issue: Still redirecting to `/home` directly

**Possible causes:**
1. **Old magic link**: If you clicked a magic link sent before the code change, it will have the old redirect URL. Request a new magic link.
2. **Supabase Site URL**: Check that your Supabase Site URL isn't set to `https://flyrpro.app/home` - it should be `https://flyrpro.app` or blank.
3. **Redirect URLs not whitelisted**: Make sure `/auth/callback` is in your Supabase Redirect URLs list.

### Issue: Redirect loop

If you see a redirect loop, check:
1. The callback route is accessible (not blocked by middleware)
2. The `code` parameter is being passed correctly
3. Supabase environment variables are set correctly

### Issue: "Invalid redirect URL"

This means Supabase doesn't recognize the redirect URL. Add it to the **Redirect URLs** list in Supabase dashboard.

## 📝 Summary

- ✅ Code uses `window.location.origin` (no hardcoded domains)
- ✅ All redirects go through `/auth/callback` route
- ✅ Works in local, preview, and production automatically
- ✅ Old magic links are handled gracefully
- ⚠️ **Action Required**: Add redirect URLs to Supabase dashboard


