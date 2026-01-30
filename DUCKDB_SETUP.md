# DuckDB Setup for Overture Extraction

## Overview

The Overture sync functionality requires DuckDB to extract building and transportation data from Overture S3 buckets. The service now supports **MotherDuck** (cloud-based DuckDB) as the primary method, with local DuckDB as a fallback.

## ✅ Option 1: MotherDuck (Recommended - Cloud-Based)

MotherDuck provides cloud-based DuckDB without local installation. **This is now the default and recommended approach.**

### Setup

1. **Get MotherDuck Token**: 
   - Sign up at https://motherduck.com
   - Generate a token from your dashboard
   - Your token is already configured in the code

2. **Add Environment Variable**:
   ```bash
   # .env.local or Vercel Environment Variables
   MOTHERDUCK_TOKEN=your-motherduck-token-here
   ```

3. **That's it!** The service will automatically use MotherDuck when the token is present.

### Benefits
- ✅ No local installation required
- ✅ Works on Vercel/serverless out of the box
- ✅ Faster queries (cloud infrastructure)
- ✅ No binary size concerns

## Option 2: Local DuckDB Binary (Fallback)

If MotherDuck token is not set, the service falls back to local DuckDB:

1. Install DuckDB binary:
   - macOS: `brew install duckdb`
   - Linux: Download from https://duckdb.org/docs/installation/
   - Windows: Download from https://duckdb.org/docs/installation/

2. Ensure `duckdb` is in your PATH

## Option 3: Node.js Package (Alternative)

```bash
npm install duckdb
```

Then update `lib/services/OvertureService.ts` to use the Node.js API instead of execAsync.

## Testing

### With MotherDuck (Recommended)

1. Ensure `MOTHERDUCK_TOKEN` is set in your environment
2. Test the sync endpoint:

```bash
curl -X POST http://localhost:3000/api/overture/sync-neighborhood \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "your-campaign-id",
    "bbox": {
      "west": -79.4,
      "south": 43.6,
      "east": -79.3,
      "north": 43.7
    }
  }'
```

### With Local DuckDB

1. Ensure DuckDB binary is installed and in PATH
2. Unset `MOTHERDUCK_TOKEN` or set `USE_MOTHERDUCK=false`
3. Run the same test command

## Environment Variables

Add to your `.env.local` or Vercel environment variables:

```env
# MotherDuck Token (Recommended)
MOTHERDUCK_TOKEN=your-motherduck-token-here

# Optional: Force local DuckDB even if token exists
USE_MOTHERDUCK=false
```

## Overture Release Version

The current implementation uses Overture release `2025-12-17.0`. Update `OVERTURE_RELEASE` in `OvertureService.ts` when new releases are available.

## MotherDuck API Notes

The service uses MotherDuck's HTTP API. If you need to use the Node.js SDK instead, you can install:

```bash
npm install @motherduck/motherduck-sdk
```

And update `OvertureService.ts` to use the SDK instead of fetch calls.

