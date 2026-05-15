# Snap to Roads 500 Error - Fix Summary

## Problem
The `/api/campaigns/[campaignId]/snap` endpoint returns a 500 Internal Server Error with message "failed to snap roads".

## Likely Causes

### 1. RLS (Row Level Security) Issues
The `overture_transportation` table has RLS enabled, and the `get_roads_in_bbox` function was not using `SECURITY DEFINER`. This means the function was running with the permissions of the calling user, who may not have access to read the roads table.

### 2. Missing Error Handling
The original code had minimal error handling, making it hard to diagnose the exact issue.

### 3. Edge Cases in BBOX Creation
The SQL function could fail if coordinates were invalid or created a degenerate bbox.

## Fix Applied

### Database Changes (`20260216150000_fix_snap_to_roads_rpc.sql`)

1. **Added `SECURITY DEFINER`** to `get_roads_in_bbox`
   - Allows the function to bypass RLS and read roads data
   - Grants execute permissions to authenticated and service roles

2. **Added input validation**
   - Checks for NULL parameters
   - Validates that min < max for both lon and lat
   - Wraps geometry creation in try/catch

3. **Added error handling to both functions**
   - `get_roads_in_bbox`
   - `update_campaign_boundary`

### Code Changes

1. **`lib/services/snapping.ts`**
   - Added comprehensive logging at each step
   - Throws errors instead of silently returning empty arrays
   - Validates bbox values before calling RPC

2. **`app/api/campaigns/[campaignId]/snap/route.ts`**
   - Added detailed logging throughout the request lifecycle
   - Better error messages in responses
   - Proper error handling for snapping service failures

## How to Apply the Fix

### Option 1: Apply Migration (Recommended)
```bash
# Reset database with new migration
supabase db reset

# Or push to specific environment
supabase db push
```

### Option 2: Manual SQL (if migration already ran)
```sql
-- Run the migration SQL manually in Supabase SQL Editor
-- Copy contents of: 20260216150000_fix_snap_to_roads_rpc.sql
```

## How to Verify

### 1. Run Diagnostic Script
```bash
# Set your service role key
export SUPABASE_SERVICE_ROLE_KEY=your_key_here

# Run diagnostics
npx tsx scripts/diagnose-snap-error.ts
```

### 2. Test via API
```bash
# Get a valid campaign ID and auth token, then:
curl -X POST \
  https://www.flyrpro.app/api/campaigns/YOUR_CAMPAIGN_ID/snap \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### 3. Check Vercel Logs
After deploying, check Vercel function logs for detailed error messages.

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| "function get_roads_in_bbox does not exist" | Migration hasn't been applied. Run `supabase db push` |
| "permission denied for table overture_transportation" | Function needs `SECURITY DEFINER`. Re-run migration |
| "Invalid bbox" | Polygon coordinates are malformed. Check client-side geometry |
| "Campaign not found" | Check campaign ID and user authentication |

## Deployment Checklist

- [ ] Migration `20260216150000_fix_snap_to_roads_rpc.sql` applied
- [ ] Code changes pushed to Git
- [ ] Vercel deployment completed
- [ ] Diagnostic script runs successfully
- [ ] API endpoint returns 200 (not 500)

## Debugging

If the error persists, check these logs in order:

1. **Vercel Function Logs** - Look for `[snap]` prefixed messages
2. **Supabase Logs** - Check PostgreSQL logs for SQL errors
3. **Browser Console** - Check network tab for response details

Key log messages to look for:
```
[snap] Starting snap request for campaign: xxx
[snap] Input polygon vertices: N
[SnappingService] Fetching roads in bbox: {...}
[SnappingService] Parsed X road segments
```
