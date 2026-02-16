# iOS Implementation Summary: Linked Homes & Stats Card

## 📚 Documentation Index

Your iOS implementation is documented across 4 comprehensive guides:

1. **IOS_IMPLEMENTATION_GUIDE.md** - Complete technical implementation
2. **IOS_QUICK_REFERENCE.md** - Fast lookup for common queries
3. **IOS_LOGIC_TRANSLATION.md** - TypeScript → Swift direct translations
4. **IOS_DATA_FLOW_DIAGRAM.md** - Visual data flow and architecture

## 🎯 What You're Building

A feature where users can:
- Tap on a building on the map (identified by GERS ID)
- See a beautiful stats card with:
  - Full address
  - List of residents/contacts
  - QR code scan status
  - Action buttons (Navigate, Log Visit, Add Contact)
- See buildings colored by status:
  - 🟡 Yellow: QR code scanned
  - 🔵 Blue: Hot lead (conversations)
  - 🟢 Green: Visited/touched
  - 🔴 Red: Not visited/untouched
- Get real-time updates when QR codes are scanned

## 🏗️ Core Architecture

### The Magic: GERS ID Bridge

The entire system revolves around connecting **map buildings** (visual) to **business data** (contacts, QR codes):

```
Map Building (GERS ID) 
    ↓
campaign_addresses (bridge table)
    ↓
Contacts, QR Codes, Scan Events
```

### Three Main Components

1. **BuildingDataService** (Data fetching)
   - Resolves GERS ID → Address → Contacts
   - Handles two lookup paths (direct + fallback)
   - Observable object for SwiftUI

2. **LocationCardView** (UI)
   - SwiftUI view that displays building stats
   - Shows address, residents, QR status
   - Action buttons for user interactions

3. **BuildingStatsSubscriber** (Real-time)
   - Subscribes to Supabase real-time events
   - Updates map colors when QR codes scanned
   - Handles building_stats table changes

## ✅ Implementation Checklist

### Phase 1: Setup (30 min)

- [ ] Add Supabase Swift SDK to project
  ```swift
  .package(url: "https://github.com/supabase/supabase-swift.git", from: "1.0.0")
  ```
- [ ] Configure Supabase client with your credentials
- [ ] Create Models.swift with data structures:
  - [ ] `ResolvedAddress`
  - [ ] `Contact`
  - [ ] `QRStatus`
  - [ ] `BuildingFeatureProperties`

### Phase 2: Data Fetching (2 hours)

- [ ] Create `BuildingDataService.swift`
- [ ] Implement `fetchBuildingData(gersId:campaignId:)` method
- [ ] Add Query Path 1: Direct campaign_addresses lookup
- [ ] Add Query Path 2: Fallback via building_address_links
- [ ] Add contacts fetch for resolved address
- [ ] Test with valid GERS IDs from your database

### Phase 3: UI Component (2 hours)

- [ ] Create `LocationCardView.swift`
- [ ] Implement loading state
- [ ] Implement error state
- [ ] Implement unlinked building state
- [ ] Implement main content view with:
  - [ ] Header (address + status badge)
  - [ ] Residents row
  - [ ] Notes section (conditional)
  - [ ] QR status row
  - [ ] Action buttons footer
- [ ] Test all states with mock data

### Phase 4: Map Integration (2 hours)

- [ ] Create `BuildingAnnotation` class
- [ ] Create `BuildingAnnotationView` class
- [ ] Implement color logic based on status
- [ ] Add tap gesture to show LocationCard
- [ ] Fetch building features via RPC:
  ```swift
  supabase.rpc('rpc_get_campaign_full_features', ...)
  ```
- [ ] Render buildings on map with correct colors

### Phase 5: Real-time Updates (1 hour)

- [ ] Create `BuildingStatsSubscriber.swift`
- [ ] Subscribe to `building_stats` table changes
- [ ] Implement `onUpdate` callback
- [ ] Update building annotation colors in real-time
- [ ] Test by scanning QR code (building should turn purple)

### Phase 6: Testing (2 hours)

- [ ] Write unit tests for BuildingDataService
- [ ] Write unit tests for color logic
- [ ] Write UI tests for LocationCard states
- [ ] Test real-time updates
- [ ] Test error handling
- [ ] Test with different building scenarios:
  - [ ] Building with residents
  - [ ] Building without residents
  - [ ] Building with QR scans
  - [ ] Building without address link
  - [ ] Invalid GERS ID

### Phase 7: Polish (1 hour)

- [ ] Add loading animations
- [ ] Add error retry logic
- [ ] Implement caching (5-minute TTL)
- [ ] Add haptic feedback on tap
- [ ] Add smooth transitions
- [ ] Optimize performance for large datasets

## 🔑 Critical Code Snippets

### Initialize Supabase Client

```swift
// AppDelegate.swift or App.swift
let supabase = SupabaseClient(
    supabaseURL: URL(string: "YOUR_SUPABASE_URL")!,
    supabaseKey: "YOUR_SUPABASE_ANON_KEY"
)
```

### Fetch Building Data (Core Logic)

```swift
let address = try await supabase
    .from("campaign_addresses")
    .select("*")
    .eq("campaign_id", value: campaignId.uuidString)
    .or("gers_id.eq.\(gersId.uuidString),building_gers_id.eq.\(gersId.uuidString)")
    .maybeSingle()
    .execute()
    .value
```

### Show Location Card on Map Tap

```swift
// In MapViewController
func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
    guard let annotation = view.annotation as? BuildingAnnotation else { return }
    
    let cardView = LocationCardView(
        gersId: annotation.gersId,
        campaignId: currentCampaignId,
        supabase: supabaseClient
    )
    
    let hostingController = UIHostingController(rootView: cardView)
    present(hostingController, animated: true)
}
```

### Real-time Color Update

```swift
statsSubscriber.onUpdate = { [weak self] gersId, status, scansTotal, qrScanned in
    let properties = BuildingFeatureProperties(
        status: status,
        scansTotal: scansTotal,
        qrScanned: qrScanned
    )
    
    let newColor = properties.getColor()
    self?.updateBuildingColor(gersId: gersId, color: newColor)
}
```

## 🎨 Building Color Logic (Critical)

**Priority Order** (check in this exact order):

1. ⚠️ **IF** `scans_total > 0` **OR** `qr_scanned == true` → 🟡 **YELLOW**
2. **ELSE IF** `status == "hot"` → 🔵 **BLUE**
3. **ELSE IF** `status == "visited"` → 🟢 **GREEN**
4. **ELSE** → 🔴 **RED** (default)

```swift
func getColor() -> UIColor {
    if qrScanned == true || scansTotal > 0 {
        return UIColor(hex: "#FCD34D") // Yellow
    }
    if status == "hot" {
        return UIColor(hex: "#3B82F6") // Blue
    }
    if status == "visited" {
        return UIColor(hex: "#10B981") // Green
    }
    return UIColor(hex: "#EF4444") // Red
}
```

## 🗺️ Map Integration Notes

### Use MapKit or Mapbox?

The web app uses **Mapbox GL JS**. For iOS, you have two options:

1. **MapKit** (Native)
   - ✅ Native Apple framework
   - ✅ Better performance
   - ✅ Easier integration
   - ❌ Less customization than Mapbox

2. **Mapbox iOS SDK**
   - ✅ 1:1 parity with web app
   - ✅ Same RPC functions work
   - ✅ Identical feature properties
   - ❌ Additional dependency

**Recommendation**: Start with **MapKit** for simplicity, migrate to Mapbox if you need advanced features.

## 📊 Database Queries Quick Reference

### Query 1: Get Address (Direct)
```swift
campaign_addresses WHERE gers_id = ? AND campaign_id = ?
```

### Query 2: Get Address (Via Links)
```swift
building_address_links 
  JOIN campaign_addresses 
  WHERE building_id IN (SELECT id FROM map_buildings WHERE gers_id = ?)
  AND campaign_id = ?
```

### Query 3: Get Residents
```swift
contacts WHERE address_id = ?
```

### Query 4: Get Building Features (RPC)
```swift
supabase.rpc('rpc_get_campaign_full_features', { p_campaign_id: ? })
```

## 🚨 Common Pitfalls

### ❌ DON'T:
1. Query `map_buildings` for contact/resident data (it doesn't have any)
2. Forget to handle nil GERS IDs (some buildings may not have them)
3. Block the main thread with network calls (always use async/await)
4. Subscribe to real-time updates and forget to unsubscribe (memory leak)
5. Hardcode colors (use the priority system)

### ✅ DO:
1. Always use `campaign_addresses` as the bridge to business data
2. Handle both direct lookup and fallback via building_address_links
3. Cache aggressively (5-minute TTL recommended)
4. Unsubscribe from real-time channels on view disappear
5. Test with real production data (not just mock data)

## 🧪 Testing Strategy

### Unit Tests
```swift
// Test data fetching
func testFetchBuildingDataWithValidGersId() async throws {
    let service = BuildingDataService(supabase: mockSupabase)
    await service.fetchBuildingData(gersId: testGersId, campaignId: testCampaignId)
    XCTAssertNotNil(service.address)
}

// Test color logic
func testBuildingColorPriority() {
    let props = BuildingFeatureProperties(status: "hot", scansTotal: 1, qrScanned: true)
    XCTAssertEqual(props.getEffectiveStatus(), .qrScanned) // Yellow overrides blue
}
```

### UI Tests
```swift
func testLocationCardDisplaysAddress() {
    let app = XCUIApplication()
    app.launch()
    
    app.maps.firstMatch.tap() // Tap building
    
    XCTAssertTrue(app.staticTexts["123 Main Street"].exists)
    XCTAssertTrue(app.buttons["Navigate"].exists)
}
```

## 📈 Performance Tips

1. **Batch Queries**: If loading multiple buildings, batch the queries
2. **Cache Aggressively**: Building data rarely changes
3. **Lazy Load QR Images**: Only load QR codes when card is visible
4. **Debounce Map Events**: Don't fetch on every pan/zoom
5. **Use RPC Functions**: They're optimized server-side

## 🎯 Success Metrics

Your implementation is successful when:

- [x] User taps building, sees card in < 500ms
- [x] Address, residents, and QR status all display correctly
- [x] Building colors match the web app
- [x] Scanning QR code updates building color in real-time (< 2s)
- [x] App handles no-data cases gracefully (unlinked buildings)
- [x] No crashes or errors in production
- [x] Real-time updates work without manual refresh

## 📞 Support & Resources

### Documentation Files
- `IOS_IMPLEMENTATION_GUIDE.md` - Full implementation details
- `IOS_QUICK_REFERENCE.md` - Quick lookup guide
- `IOS_LOGIC_TRANSLATION.md` - TypeScript → Swift translations
- `IOS_DATA_FLOW_DIAGRAM.md` - Visual architecture

### Key Database Tables
- `map_buildings` - Building geometries
- `campaign_addresses` - Address/business data (THE BRIDGE)
- `building_address_links` - Building-to-address connections
- `contacts` - Resident information
- `building_stats` - Real-time status/scans

### RPC Functions
- `rpc_get_campaign_full_features` - Get all buildings for campaign
- `rpc_get_buildings_in_bbox` - Get buildings in bounding box

## 🚀 Next Steps

1. **Review all 4 documentation files** in `/docs`
2. **Set up your development environment** (Supabase SDK)
3. **Start with Phase 1** (Setup) from the checklist above
4. **Test each phase** before moving to the next
5. **Deploy to TestFlight** for QA testing
6. **Monitor Supabase logs** for any query issues

## 💡 Pro Tips

- The **GERS ID is the golden key** to everything
- `campaign_addresses.gers_id` is the **most important field**
- Always query by **both** `gers_id` AND `campaign_id`
- Real-time updates are **optional but impressive**
- Cache everything, invalidate on real-time updates
- Test with **real production data** as soon as possible

---

## 🎓 Learning Path

If you're new to this codebase:

1. **Start here**: Read `IOS_QUICK_REFERENCE.md` (15 min)
2. **Understand data flow**: Read `IOS_DATA_FLOW_DIAGRAM.md` (20 min)
3. **See code examples**: Read `IOS_LOGIC_TRANSLATION.md` (30 min)
4. **Deep dive**: Read `IOS_IMPLEMENTATION_GUIDE.md` (1 hour)
5. **Start coding**: Follow the checklist above (8-10 hours)

## 📝 Final Notes

This is a **complex feature** that touches multiple database tables and requires careful data linking. The key insight is understanding how **GERS ID bridges map buildings to business data** via the `campaign_addresses` table.

Take your time with each phase, test thoroughly, and don't hesitate to refer back to the documentation. The web app logic is battle-tested and works well, so following the same patterns will ensure success.

Good luck! 🚀
