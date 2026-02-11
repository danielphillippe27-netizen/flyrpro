# FLYR PRO - iOS Implementation Documentation

## 📱 iOS Linked Homes & Stats Card Feature

This documentation package contains everything you need to implement the "linked homes" feature and building stats card in your iOS app.

## 📚 Documentation Structure

| File | Purpose | Estimated Read Time |
|------|---------|---------------------|
| **IOS_IMPLEMENTATION_SUMMARY.md** | Start here! Overview and checklist | 20 min |
| **IOS_QUICK_REFERENCE.md** | Fast lookup for common queries | 10 min |
| **IOS_DATA_FLOW_DIAGRAM.md** | Visual architecture and data flow | 15 min |
| **IOS_LOGIC_TRANSLATION.md** | TypeScript → Swift translations | 30 min |
| **IOS_IMPLEMENTATION_GUIDE.md** | Complete technical reference | 60 min |

## 🚀 Quick Start (5 Steps)

1. **Read** `IOS_IMPLEMENTATION_SUMMARY.md` - Understand what you're building
2. **Study** `IOS_QUICK_REFERENCE.md` - Learn the key queries
3. **Review** `IOS_DATA_FLOW_DIAGRAM.md` - Visualize the architecture
4. **Implement** following the checklist in the summary
5. **Reference** the other docs as needed during implementation

## 🎯 What This Feature Does

### User Experience

When a user taps on a building on the map:

```
1. Map shows buildings colored by status (red/green/blue/yellow)
2. User taps a building
3. Beautiful card slides up showing:
   • Address
   • Residents/contacts
   • QR scan status
   • Action buttons (Navigate, Log Visit, Add Contact)
4. When QR code is scanned, building turns yellow in real-time
```

### Technical Flow

```
GERS ID (from map tap)
    ↓
campaign_addresses (lookup by gers_id)
    ↓
contacts (lookup by address_id)
    ↓
Display LocationCard UI
```

## 🗺️ Architecture Overview

```
┌─────────────────────────────────────────┐
│           iOS App                        │
├─────────────────────────────────────────┤
│                                          │
│  MapView (MapKit/Mapbox)                 │
│    ├─ BuildingAnnotations (colored)     │
│    └─ Tap handler                        │
│                                          │
│  BuildingDataService                     │
│    ├─ fetchBuildingData()                │
│    └─ @Published properties              │
│                                          │
│  LocationCardView (SwiftUI)              │
│    ├─ Address display                    │
│    ├─ Residents list                     │
│    ├─ QR status                          │
│    └─ Action buttons                     │
│                                          │
│  BuildingStatsSubscriber                 │
│    └─ Real-time updates                  │
│                                          │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│      Supabase (Backend)                  │
├─────────────────────────────────────────┤
│                                          │
│  Database Tables:                        │
│    ├─ map_buildings (geometries)         │
│    ├─ campaign_addresses (bridge) 🔑     │
│    ├─ building_address_links (links)     │
│    ├─ contacts (residents)               │
│    ├─ building_stats (status)            │
│    └─ scan_events (QR scans)             │
│                                          │
│  RPC Functions:                          │
│    ├─ rpc_get_campaign_full_features     │
│    └─ rpc_get_buildings_in_bbox          │
│                                          │
│  Real-time:                              │
│    └─ building_stats changes             │
│                                          │
└──────────────────────────────────────────┘
```

## 🔑 Key Concepts

### GERS ID
- **What**: Global Entity Reference System ID from Overture Maps
- **Format**: UUID v4 (128-bit)
- **Purpose**: Unique identifier for buildings globally
- **Usage**: Primary key for linking map buildings to business data

### The Bridge Table
- **Table**: `campaign_addresses`
- **Why it matters**: This is THE central table connecting buildings to business data
- **Key field**: `gers_id` - links to map buildings
- **What it contains**: Address, QR codes, scan counts, location

### Building Status Colors
- 🟡 **Yellow** - QR scanned (highest priority)
- 🔵 **Blue** - Hot lead / conversations
- 🟢 **Green** - Visited / touched
- 🔴 **Red** - Not visited / untouched (default)

## 📖 Reading Guide by Role

### If you're a **Mobile Developer**:
1. Start: `IOS_IMPLEMENTATION_SUMMARY.md`
2. Reference: `IOS_QUICK_REFERENCE.md` (bookmark this!)
3. Deep dive: `IOS_IMPLEMENTATION_GUIDE.md`
4. Code examples: `IOS_LOGIC_TRANSLATION.md`

### If you're a **Backend Developer**:
1. Start: `IOS_DATA_FLOW_DIAGRAM.md`
2. Reference: `IOS_QUICK_REFERENCE.md`
3. Understand queries: `IOS_IMPLEMENTATION_GUIDE.md` (Database Schema section)

### If you're a **Product Manager**:
1. Start: `IOS_IMPLEMENTATION_SUMMARY.md` (What You're Building section)
2. Visual: `IOS_DATA_FLOW_DIAGRAM.md` (System Overview)
3. Testing: `IOS_IMPLEMENTATION_SUMMARY.md` (Success Metrics section)

### If you're a **QA Engineer**:
1. Start: `IOS_IMPLEMENTATION_SUMMARY.md` (Testing Strategy section)
2. Test cases: `IOS_IMPLEMENTATION_GUIDE.md` (Testing Checklist section)
3. Data flow: `IOS_DATA_FLOW_DIAGRAM.md`

## 🎓 Learning Path

### Beginner (Never seen this codebase)
```
Time: ~2 hours

1. IOS_IMPLEMENTATION_SUMMARY.md (20 min)
   └─ Understand what you're building

2. IOS_QUICK_REFERENCE.md (10 min)
   └─ Learn the key database queries

3. IOS_DATA_FLOW_DIAGRAM.md (20 min)
   └─ Visualize how data flows

4. IOS_LOGIC_TRANSLATION.md (30 min)
   └─ See web app vs iOS side-by-side

5. IOS_IMPLEMENTATION_GUIDE.md (60 min)
   └─ Full technical deep dive
```

### Intermediate (Familiar with React/TypeScript)
```
Time: ~1 hour

1. IOS_LOGIC_TRANSLATION.md (20 min)
   └─ See direct TypeScript → Swift translations

2. IOS_QUICK_REFERENCE.md (10 min)
   └─ Learn the queries

3. IOS_IMPLEMENTATION_GUIDE.md (30 min)
   └─ Focus on Swift code sections
```

### Advanced (iOS expert, just need the spec)
```
Time: ~30 min

1. IOS_QUICK_REFERENCE.md (10 min)
   └─ Get the queries

2. IOS_IMPLEMENTATION_GUIDE.md (20 min)
   └─ Scan code examples and API section
```

## 🔧 Implementation Checklist

- [ ] **Setup** (30 min)
  - [ ] Add Supabase Swift SDK
  - [ ] Create data models
  - [ ] Configure Supabase client

- [ ] **Data Fetching** (2 hours)
  - [ ] Implement BuildingDataService
  - [ ] Add query Path 1 (direct lookup)
  - [ ] Add query Path 2 (fallback via links)
  - [ ] Test with real GERS IDs

- [ ] **UI Component** (2 hours)
  - [ ] Create LocationCardView
  - [ ] Implement all states (loading, error, success)
  - [ ] Add action buttons
  - [ ] Polish animations

- [ ] **Map Integration** (2 hours)
  - [ ] Add building annotations
  - [ ] Implement color logic
  - [ ] Add tap handler
  - [ ] Render buildings from RPC

- [ ] **Real-time Updates** (1 hour)
  - [ ] Create BuildingStatsSubscriber
  - [ ] Subscribe to building_stats
  - [ ] Update colors on scan events

- [ ] **Testing** (2 hours)
  - [ ] Write unit tests
  - [ ] Write UI tests
  - [ ] Test real-time updates
  - [ ] Test error cases

- [ ] **Polish** (1 hour)
  - [ ] Add caching
  - [ ] Optimize performance
  - [ ] Add haptics
  - [ ] Final QA

**Total Estimated Time**: 8-10 hours

## 🚨 Critical Success Factors

### ✅ Must Have
1. **Correct GERS ID → Address resolution**
   - This is the foundation of everything
   
2. **Proper status color priority**
   - Yellow (QR scanned) always wins
   
3. **Real-time updates work**
   - Building turns yellow when QR scanned

4. **Handle unlinked buildings gracefully**
   - Show clear UI when no address found

### ⚠️ Common Mistakes to Avoid
1. ❌ Querying `map_buildings` for contact data (wrong table!)
2. ❌ Forgetting campaign_id in queries (gets wrong data)
3. ❌ Blocking main thread with network calls (UI freezes)
4. ❌ Not unsubscribing from real-time (memory leak)
5. ❌ Hardcoding colors (breaks when status changes)

## 📊 Success Metrics

Your implementation is complete when:

- [ ] Tapping building shows card in < 500ms
- [ ] All data displays correctly (address, residents, QR status)
- [ ] Building colors match web app
- [ ] Real-time updates work (< 2 seconds)
- [ ] Handles edge cases (unlinked buildings, no residents)
- [ ] No crashes in production
- [ ] Passes all test cases

## 🆘 Troubleshooting

### Problem: Building tap shows "Unlinked Building"
**Solution**: Check if `campaign_addresses` has a row with matching `gers_id`

### Problem: Residents not showing
**Solution**: Verify `contacts.address_id` matches the resolved `campaign_addresses.id`

### Problem: Colors wrong
**Solution**: Check status priority logic - QR scanned (yellow) should always win

### Problem: Real-time updates not working
**Solution**: Verify Supabase real-time is enabled on `building_stats` table

### Problem: Query returns nothing
**Solution**: Make sure you're passing `campaign_id` in all queries

## 📞 Support

### Documentation Issues
If docs are unclear or missing information, create an issue with:
- Which document
- Which section
- What's unclear/missing

### Implementation Help
If stuck during implementation:
1. Check the relevant doc in this folder
2. Review the web app implementation in `/components/map/`
3. Check Supabase database schema in `/supabase/migrations/`

### Database Questions
For database schema or query questions:
- See `IOS_IMPLEMENTATION_GUIDE.md` (Database Schema section)
- Check actual migrations in `/supabase/migrations/`
- Use SQL file: `/scripts/debug-scan-colors.sql` for testing

## 🔗 Related Files (Web App Reference)

To understand how the web app implements this:

- `/components/map/LocationCard.tsx` - UI component
- `/components/map/MapBuildingsLayer.tsx` - Map rendering + real-time
- `/lib/hooks/useBuildingData.ts` - Data fetching hook
- `/lib/services/BuildingService.ts` - Building operations
- `/types/map-buildings.ts` - TypeScript types

## 📈 Version History

- **v1.0** (Feb 2026) - Initial iOS documentation
  - Complete implementation guide
  - Quick reference
  - Data flow diagrams
  - Logic translations
  - Implementation checklist

## 🎯 Next Steps

1. **Start here**: Open `IOS_IMPLEMENTATION_SUMMARY.md`
2. **Set up environment**: Add Supabase SDK to your iOS project
3. **Follow the checklist**: Complete each phase in order
4. **Test thoroughly**: Use the testing strategy in the docs
5. **Deploy**: Ship to TestFlight for QA

---

**Note**: All paths in this documentation assume you're in the `/docs` folder. Adjust paths if you move these files.

**Happy coding!** 🚀📱
