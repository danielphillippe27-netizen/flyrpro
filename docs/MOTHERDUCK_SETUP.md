# MotherDuck Setup Guide

## Quick Start

To enable MotherDuck integration for unified building data:

### 1. Get MotherDuck Token

1. Sign up at https://motherduck.com
2. Generate a token from your dashboard
3. Copy the token

### 2. Get Supabase Database Password

You need the database password (not the anon key) to connect from MotherDuck:

**Option A: Database Password (Recommended)**
1. Go to https://supabase.com/dashboard
2. Select your project (kfnsnwqylsdsbgnwgxva)
3. Navigate to **Settings** → **Database**
4. Scroll down to **Connection string** section
5. Look for **Connection pooling** or **Direct connection**
6. The password is in the connection string: `postgres://postgres:[YOUR-PASSWORD]@db.kfnsnwqylsdsbgnwgxva.supabase.co:5432/postgres`
   - Or find it under **Database password** field
   - If you don't see it, you may need to reset it (Settings → Database → Reset database password)

**Option B: Service Role Key (Alternative)**
1. Go to https://supabase.com/dashboard
2. Select your project
3. Navigate to **Settings** → **API**
4. Find **service_role** key (NOT the anon key)
5. Copy the **service_role** secret key
6. Use this as `SUPABASE_SERVICE_ROLE_KEY` instead of `SUPABASE_DB_PASSWORD`

### 3. Set Environment Variables

Add to your `.env.local` (for local development) or Vercel environment variables:

```bash
# MotherDuck token (required)
MOTHERDUCK_TOKEN=md_your_token_here

# Supabase database password (required for MotherDuck → Supabase connection)
SUPABASE_DB_PASSWORD=your_database_password_here
# OR use service role key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### 4. Verify Connection

The system will automatically:
- Try MotherDuck first if token is present
- Fall back to existing services if MotherDuck fails or is unavailable
- Log connection status in console

### Testing

1. Start your dev server: `npm run dev`
2. Navigate to a campaign detail page
3. Check browser console for `[buildings-unified]` logs
4. If MotherDuck is working, you'll see: `Using MotherDuck for campaign...`
5. If fallback is used, you'll see: `Using fallback approach for campaign...`

## Troubleshooting

### "MotherDuck token is required but not provided"
- Ensure `MOTHERDUCK_TOKEN` is set in environment variables
- Restart your dev server after adding the variable

### "Failed to attach Supabase"
- Check that `SUPABASE_DB_PASSWORD` or `SUPABASE_SERVICE_ROLE_KEY` is set
- Verify the password is correct (not the anon key)
- Check Supabase project settings for database access

### "No buildings found"
- Verify campaign has addresses with valid geometry
- Check that Overture data exists for your area
- Review console logs for specific errors

### Fallback Mode
If MotherDuck fails, the system automatically falls back to:
- Existing `BuildingService` for buildings
- Existing `CampaignsService` for addresses
- Manual combination of data sources

This ensures the system always works, even without MotherDuck.
