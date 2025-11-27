# FLYR Web App - Testing Guide

## Quick Start

### 1. Install Dependencies (if not already done)
```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env.local` file in the root directory with:

```env
# Supabase (Required - use your iOS Supabase credentials)
NEXT_PUBLIC_SUPABASE_URL=https://kfnsnwqylsdsbgnwgxva.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Mapbox (Required - token is already provided)
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1IjoiZmx5cnBybyIsImEiOiJjbWd6dzZsbm0wYWE3ZWpvbjIwNGVteDV6In0.lvbLszJ7ADa_Cck3A8hZEQ

# Stripe (Optional - for payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_BASE_URL=http://localhost:3000
```

### 3. Start the Development Server

```bash
npm run dev
```

The app will be available at: **http://localhost:3000**

---

## Testing Checklist

### ✅ Navigation & Layout
- [ ] Bottom tab bar appears with 5 tabs (Home, Map, QR, CRM, Stats)
- [ ] Clicking tabs navigates correctly
- [ ] Active tab is highlighted
- [ ] Layout is responsive on mobile/desktop

### ✅ Home Tab
- [ ] Home page loads with 3 sections (Campaigns, Challenges, Farms)
- [ ] "Create" button opens CreateHubView modal
- [ ] Campaigns list displays (if any exist)
- [ ] Challenges list displays (if any exist)
- [ ] Farms list displays (if any exist)
- [ ] Empty states show when no data exists

### ✅ Campaigns
- [ ] Click "Create" → "Campaign" opens campaign creation form
- [ ] Can select campaign type (flyer, door_knock, etc.)
- [ ] Can select address source (closest_home, import_list, map, same_street)
- [ ] Can create a campaign
- [ ] Campaign appears in campaigns list
- [ ] Click campaign → opens detail page
- [ ] Campaign detail shows progress bar
- [ ] "Map" tab shows map with addresses (if addresses exist)
- [ ] "Addresses" tab shows address list
- [ ] Can upload CSV file
- [ ] Can generate QR codes

### ✅ Map Tab
- [ ] Map loads with Mapbox
- [ ] Map mode toggle works (Light, Dark, Satellite, 3D Buildings)
- [ ] Map is interactive (zoom, pan)
- [ ] Building polygons render (if available)
- [ ] Address markers appear (if campaign addresses exist)

### ✅ QR Codes Tab
- [ ] QR workflow view loads
- [ ] "Create QR Code" button opens creation form
- [ ] Can create QR code with source selection
- [ ] QR codes list displays
- [ ] Analytics tab shows statistics
- [ ] QR code images display (if generated)

### ✅ Farms Tab
- [ ] Click "Create" → "Farm" opens farm creation form
- [ ] Can create a farm with name, dates, frequency
- [ ] Farm appears in farms list
- [ ] Click farm → opens detail page
- [ ] Farm detail shows progress, touches, leads
- [ ] Can schedule touches
- [ ] Can create leads

### ✅ Challenges Tab
- [ ] Click "Create" → "Challenge" opens challenge creation form
- [ ] Can create challenge with type, goal, time limit
- [ ] Challenge appears in challenges list
- [ ] Click challenge → opens detail page
- [ ] Progress bar updates
- [ ] "Increment Progress" button works
- [ ] Completion state shows when goal reached

### ✅ CRM Tab
- [ ] Contacts hub loads
- [ ] Contact list displays (if any exist)
- [ ] Filter by status works
- [ ] Click contact → opens detail sheet
- [ ] Can log activities (call, note, etc.)
- [ ] Activity history displays

### ✅ Stats Tab
- [ ] Stats page loads with "You" and "Leaderboard" tabs
- [ ] "You" tab shows personal stats (flyers, conversations, leads, etc.)
- [ ] "Leaderboard" tab shows ranked users
- [ ] Sort by different metrics works (flyers, conversations, leads, distance, time)
- [ ] Top 3 users are highlighted

---

## Common Issues & Solutions

### Map Not Loading
- **Issue**: Map shows blank or error
- **Solution**: 
  - Check `NEXT_PUBLIC_MAPBOX_TOKEN` is set in `.env.local`
  - Check browser console for errors
  - Verify Mapbox token is valid

### "Not Authenticated" Errors
- **Issue**: Can't load data, see auth errors
- **Solution**:
  - Ensure Supabase credentials are correct in `.env.local`
  - Check that you're logged in (may need to implement auth first)
  - Verify RLS policies allow access

### Database Errors
- **Issue**: Tables don't exist or queries fail
- **Solution**:
  - Ensure iOS Supabase schema matches the types
  - Check that required tables exist:
    - campaigns, campaign_addresses, building_polygons
    - qr_codes, farms, challenges, contacts, user_stats
  - Verify PostGIS extension is enabled for geometry columns

### TypeScript Errors
- **Issue**: Type errors in IDE
- **Solution**:
  - Run `npm install` to ensure all types are installed
  - Check that `types/database.ts` matches your schema
  - Restart TypeScript server in your IDE

---

## Testing with Real Data

### 1. Create Test Campaign
```
1. Go to Home → Create → Campaign
2. Name: "Test Campaign"
3. Type: "Flyer"
4. Address Source: "Import List"
5. Create campaign
6. Upload CSV with addresses
7. Generate QR codes
```

### 2. Test Map View
```
1. Go to Map tab
2. Switch between map modes
3. Create a campaign with addresses
4. View campaign on map (should show markers)
```

### 3. Test QR Workflow
```
1. Go to QR tab
2. Create QR code linked to a campaign
3. View analytics
4. Test QR redirect (scan QR code)
```

### 4. Test Farms
```
1. Create a farm territory
2. Schedule touches
3. Create leads from touches
4. View farm progress
```

### 5. Test Challenges
```
1. Create a challenge (e.g., "50 door knocks")
2. Increment progress
3. Watch progress bar update
4. Complete challenge
```

---

## Browser Testing

Test in multiple browsers:
- ✅ Chrome/Edge (Chromium)
- ✅ Safari
- ✅ Firefox
- ✅ Mobile browsers (responsive design)

---

## Performance Testing

1. **Load Times**: Check initial page load
2. **Map Performance**: Test with many markers/polygons
3. **List Rendering**: Test with 100+ campaigns/contacts
4. **Real-time Updates**: Test Supabase realtime (if implemented)

---

## Next Steps After Testing

1. Fix any bugs found
2. Add error boundaries
3. Implement missing features (real-time, etc.)
4. Optimize performance
5. Add loading states where needed
6. Improve error messages

---

## Quick Test Commands

```bash
# Start dev server
npm run dev

# Build for production (test build)
npm run build

# Run linter
npm run lint

# Start production server (after build)
npm start
```

---

## Need Help?

- Check browser console for errors
- Check terminal for server errors
- Verify environment variables are set
- Ensure database schema matches types
- Check Supabase dashboard for data

