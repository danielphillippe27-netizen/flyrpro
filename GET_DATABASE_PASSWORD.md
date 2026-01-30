# How to Get Your Supabase Database Password

## Quick Steps

1. **In the Supabase Dashboard** (where you're currently viewing the connection string):

2. **Click "Database Settings"** (the link in the "Reset your database password" section)
   - OR navigate to: **Settings** → **Database**

3. **Click "Reset database password"** button

4. **Copy the new password immediately** - it's only shown once!

5. **Add to `.env.local`**:
   ```bash
   SUPABASE_DB_PASSWORD=your_new_password_here
   ```

## Alternative: Extract from Connection String

If you already have a connection string with the password filled in:
```
postgresql://postgres:ACTUAL_PASSWORD_HERE@db.kfnsnwqylsdsbgnwgxva.supabase.co:5432/postgres
```

The password is the part between `postgres:` and `@db.`

## After Getting the Password

1. Update `.env.local`:
   ```bash
   SUPABASE_DB_PASSWORD=your_actual_password
   ```

2. **Remove or comment out** `SUPABASE_SERVICE_ROLE_KEY` (you only need the database password for MotherDuck connection)

3. **Restart your dev server**:
   ```bash
   npm run dev
   ```

4. Test by navigating to a campaign page and checking console logs for `[buildings-unified] Using MotherDuck...`
