# Quick Start: MotherDuck Integration

## ✅ Environment Variables Set

Your `.env.local` file now contains:
- ✅ `MOTHERDUCK_TOKEN` - Your MotherDuck token
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key

## ⚠️ Important Note About Supabase Connection

The **service role key** (`sbp_...`) is used for API authentication, but for **direct Postgres database connections** from MotherDuck, you may need the actual **database password**.

### If Connection Fails

If you see errors like "Failed to attach Supabase" or "authentication failed", you'll need the database password:

1. Go to https://supabase.com/dashboard
2. Select your project
3. Navigate to **Settings** → **Database**
4. Scroll to **Connection string** section
5. Look for the password in the connection string, OR
6. Click **Reset database password** to set a new one
7. Update `.env.local`:
   ```bash
   SUPABASE_DB_PASSWORD=your_actual_database_password_here
   ```

### Testing the Connection

1. **Restart your dev server** (required for env vars to load):
   ```bash
   npm run dev
   ```

2. Navigate to a campaign detail page (e.g., `/campaigns/7d6639db-e91e-4654-b9ce-d6be560f2b34`)

3. Check the browser console and server logs for:
   - ✅ `[buildings-unified] Using MotherDuck for campaign...` = Success!
   - ⚠️ `[buildings-unified] Using fallback approach...` = MotherDuck not working, using fallback
   - ❌ `Failed to attach Supabase` = Need database password instead of service role key

4. If MotherDuck works, you should see:
   - Fill-extrusion buildings rendered
   - Buildings colored by campaign
   - Popups with Overture addresses on click

## Current Status

- ✅ MotherDuck token configured
- ✅ Supabase service role key configured
- ⚠️ May need database password if service role key doesn't work for Postgres connection

The system will automatically fall back to existing services if MotherDuck connection fails, so your app will continue to work either way!
