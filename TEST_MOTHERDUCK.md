# Testing MotherDuck Connection

## ✅ Configuration Complete

Your `.env.local` is now configured with:
- ✅ `MOTHERDUCK_TOKEN` - Your MotherDuck token
- ✅ `SUPABASE_DB_PASSWORD` - Your Supabase database password

## 🚀 Next Steps

### 1. Restart Your Dev Server

**Important:** Environment variables are only loaded when the server starts, so you MUST restart:

```bash
# Stop your current dev server (Ctrl+C)
# Then restart:
npm run dev
```

### 2. Test the Connection

1. **Navigate to a campaign page** (e.g., `/campaigns/7d6639db-e91e-4654-b9ce-d6be560f2b34`)

2. **Check the browser console** (F12 → Console tab) for:
   - ✅ `[buildings-unified] Using MotherDuck for campaign...` = **Success!**
   - ⚠️ `[buildings-unified] Using fallback approach...` = MotherDuck not working, using fallback
   - ❌ `Failed to attach Supabase` = Connection issue (check password)

3. **Check server logs** (terminal where `npm run dev` is running) for:
   - `[MotherDuckUnified] Initializing DuckDB (MotherDuck)...`
   - `[MotherDuckUnified] Database initialized`
   - `[MotherDuckUnified] Executing query for campaign...`
   - `[MotherDuckUnified] Found X buildings for campaign...`

### 3. Expected Behavior

If MotherDuck is working:
- Buildings should render as fill-extrusions
- Buildings should be colored by campaign status
- Clicking a building shows a popup with:
  - Address from Overture (`full_address`)
  - Campaign name
  - Building height

### 4. Troubleshooting

**If you see "Failed to attach Supabase":**
- Verify the password is correct (check for typos)
- Make sure you restarted the dev server after adding the password
- Check that the password doesn't have extra spaces

**If you see "Using fallback approach":**
- The system is still working, just not using MotherDuck
- Check server logs for specific error messages
- MotherDuck might be unavailable or there might be a connection issue

**Password with special characters:**
- If your password has `$` signs, make sure they're properly escaped in `.env.local`
- The password `Megs1989$$lol` in the file means the actual password is `Megs1989$lol` (one `$`)
- If your password actually has two `$` signs, you might need to quote it: `SUPABASE_DB_PASSWORD='Megs1989$$lol'`

## Success Indicators

✅ **MotherDuck Working:**
- Console shows "Using MotherDuck for campaign..."
- Server logs show MotherDuck query execution
- Buildings appear with Overture addresses in popups

✅ **Fallback Working (Still Good):**
- Console shows "Using fallback approach..."
- Buildings still appear and work correctly
- Just means MotherDuck isn't being used (but system still functions)
