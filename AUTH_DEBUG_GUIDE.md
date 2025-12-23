# Auth Redirect Debugging Guide

## 🔍 Current Status

The code has been updated with:
- ✅ Dynamic redirect URLs using `window.location.origin`
- ✅ Server-side callback route at `/auth/callback`
- ✅ Debug logging in browser console and server logs
- ✅ Proper error handling

## 🧪 Step-by-Step Debugging

### 1. Check Browser Console (Local Development)

1. Open `http://localhost:3000/login` in your browser
2. Open Developer Tools (F12 or Cmd+Option+I)
3. Go to the **Console** tab
4. Enter your email and click "Sign in with Email"
5. Look for these log messages:

```
🔐 Auth Redirect URL: http://localhost:3000/auth/callback?next=/home
🌐 Current Origin: http://localhost:3000
✅ Magic link sent successfully
```

**If you see these logs:**
- ✅ The code is working correctly
- The issue is likely in Supabase dashboard configuration

**If you DON'T see these logs:**
- Check for error messages in the console
- Verify `window.location.origin` is correct

### 2. Check the Magic Link Email

1. Open the magic link email from Supabase
2. **Right-click** on the "Sign in" button/link
3. Select "Copy link address" or "Inspect element"
4. Check the URL - it should look like:

```
https://kfnsnwqylsdsbgnwgxva.supabase.co/auth/v1/verify?token=...&type=email&redirect_to=http://localhost:3000/auth/callback?next=/home
```

**Important:** The `redirect_to` parameter should be `http://localhost:3000/auth/callback?next=/home`

**If it shows `https://flyrpro.app` instead:**
- This means Supabase is overriding your redirect URL
- Check Supabase dashboard → Settings → Authentication → URL Configuration
- Make sure **Site URL** is NOT set to `https://flyrpro.app` (or set it to `http://localhost:3000` for local testing)

### 3. Check Supabase Dashboard Configuration

#### Step 1: Site URL
1. Go to: https://supabase.com/dashboard/project/kfnsnwqylsdsbgnwgxva/settings/auth
2. Scroll to **URL Configuration**
3. Check **Site URL**:
   - **For local testing:** Should be `http://localhost:3000` OR blank
   - **For production:** Should be `https://flyrpro.app`
   - ⚠️ **Problem:** If Site URL is set to production, Supabase may force all redirects to production

#### Step 2: Redirect URLs (CRITICAL)
1. In the same section, find **Redirect URLs**
2. Make sure these URLs are listed (one per line):

```
http://localhost:3000/auth/callback
http://localhost:3000/home
https://flyrpro.app/auth/callback
https://flyrpro.app/home
```

3. Click **Save** after adding URLs

**If these URLs are missing:**
- Supabase will reject the redirect and send you to the Site URL instead
- This is likely why you're being redirected to production

### 4. Check Server Logs (Terminal)

When you click the magic link, check your terminal where `npm run dev` is running. You should see:

```
🔐 Auth Callback: {
  origin: 'http://localhost:3000',
  code: 'present',
  next: '/home',
  fullUrl: 'http://localhost:3000/auth/callback?code=...&next=/home'
}
✅ Code exchange successful, redirecting to: http://localhost:3000/home
```

**If you see error messages:**
- Note the exact error
- Check Supabase environment variables are set correctly

### 5. Clear Browser Cache & Cookies

Sometimes old cookies or cached redirects cause issues:

1. **Chrome/Edge:**
   - Open DevTools (F12)
   - Go to **Application** tab
   - Click **Clear storage** → **Clear site data**
   - Or manually delete cookies for `localhost:3000`

2. **Firefox:**
   - Open DevTools (F12)
   - Go to **Storage** tab
   - Right-click on Cookies → Delete All

3. **Safari:**
   - Safari → Preferences → Privacy → Manage Website Data
   - Remove `localhost:3000`

### 6. Test with Incognito/Private Window

1. Open a new incognito/private window
2. Go to `http://localhost:3000/login`
3. Try signing in again
4. This eliminates cache/cookie issues

## 🚨 Common Issues & Solutions

### Issue: "Still redirecting to production"

**Symptoms:**
- Clicking magic link sends you to `https://flyrpro.app/home`
- Even though you're testing on `http://localhost:3000`

**Solutions:**
1. **Check Supabase Site URL:**
   - Should be blank or `http://localhost:3000` for local testing
   - NOT `https://flyrpro.app`

2. **Check Redirect URLs:**
   - Must include `http://localhost:3000/auth/callback`
   - Must include `http://localhost:3000/home`

3. **Check the magic link email:**
   - The `redirect_to` parameter should be `http://localhost:3000/auth/callback?next=/home`
   - If it's `https://flyrpro.app`, Supabase is overriding it

4. **Clear browser cache** (see step 5 above)

### Issue: "Invalid redirect URL" error

**Symptoms:**
- Error message: "Invalid redirect URL"
- Redirect fails

**Solution:**
- Add the exact URL to Supabase → Settings → Authentication → Redirect URLs
- Make sure there are no typos
- URLs are case-sensitive

### Issue: Redirect loop

**Symptoms:**
- Page keeps redirecting between `/login` and `/auth/callback`

**Solution:**
1. Check that the callback route is accessible (not blocked by middleware)
2. Check browser console for errors
3. Verify `code` parameter is present in the URL

### Issue: Code exchange fails

**Symptoms:**
- Server logs show: `❌ Code exchange error: ...`

**Solution:**
1. Check Supabase environment variables:
   ```bash
   echo $NEXT_PUBLIC_SUPABASE_URL
   echo $NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```
2. Verify they match your Supabase project
3. Check that the code hasn't expired (magic links expire after a few minutes)

## 📋 Quick Checklist

Before reporting an issue, verify:

- [ ] Browser console shows correct redirect URL (`http://localhost:3000/auth/callback?next=/home`)
- [ ] Magic link email contains `redirect_to=http://localhost:3000/auth/callback?next=/home`
- [ ] Supabase Site URL is blank or `http://localhost:3000` (NOT production)
- [ ] Supabase Redirect URLs includes `http://localhost:3000/auth/callback` and `http://localhost:3000/home`
- [ ] Browser cache and cookies cleared
- [ ] Tested in incognito/private window
- [ ] Server logs show successful code exchange
- [ ] Environment variables are set correctly

## 🔧 Quick Fix: Reset Supabase Configuration

If nothing works, try this:

1. **Supabase Dashboard:**
   - Settings → Authentication → URL Configuration
   - **Site URL:** Leave blank (or set to `http://localhost:3000`)
   - **Redirect URLs:** Clear all, then add:
     ```
     http://localhost:3000/auth/callback
     http://localhost:3000/home
     https://flyrpro.app/auth/callback
     https://flyrpro.app/home
     ```
   - Click **Save**

2. **Clear browser cache** (see step 5 above)

3. **Request a new magic link** (old links may have cached redirect URLs)

4. **Test again**

## 📞 Still Not Working?

If you've tried everything above:

1. **Collect debug information:**
   - Browser console logs (screenshot)
   - Server terminal logs (screenshot)
   - Magic link URL (copy the full URL from email)
   - Supabase dashboard screenshot (Settings → Authentication → URL Configuration)

2. **Check for middleware blocking:**
   - Verify `middleware.ts` isn't blocking `/auth/callback`

3. **Verify environment variables:**
   - Run: `cat .env.local | grep SUPABASE`
   - Make sure URLs match your Supabase project

