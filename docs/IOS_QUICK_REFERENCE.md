# iOS Quick Reference: Building Stats Card

## 🎯 Quick Start

When user taps a building on the map, you get a **GERS ID** (UUID). Here's how to fetch all related data:

## 📊 Complete Data Flow

```
User Taps Building
      ↓
  GERS ID (UUID)
      ↓
Query Strategy:
1. Try campaign_addresses WHERE gers_id = ? 
2. If not found, try building_address_links
3. Fetch contacts WHERE address_id = ?
4. Fetch building_stats WHERE gers_id = ?
      ↓
Display LocationCard
```

## 🔑 Key Database Queries

### Query 1: Get Address from GERS ID

```swift
// Direct lookup (fastest path)
let address = try await supabase
    .from("campaign_addresses")
    .select("""
        id,
        house_number,
        street_name,
        formatted,
        locality,
        region,
        postal_code,
        gers_id,
        scans,
        last_scanned_at,
        qr_code_base64
    """)
    .eq("campaign_id", value: campaignId.uuidString)
    .or("gers_id.eq.\(gersId.uuidString),building_gers_id.eq.\(gersId.uuidString)")
    .maybeSingle()
    .execute()
```

### Query 2: Fallback via Building Link (if Query 1 returns nil)

```swift
// Step 2a: Find building ID
let building = try await supabase
    .from("map_buildings")
    .select("id, gers_id")
    .eq("gers_id", value: gersId.uuidString)
    .maybeSingle()
    .execute()

// Step 2b: Find linked address
let link = try await supabase
    .from("building_address_links")
    .select("""
        address_id,
        campaign_addresses!inner (
            id,
            house_number,
            street_name,
            formatted,
            locality,
            region,
            postal_code,
            gers_id,
            scans,
            last_scanned_at,
            qr_code_base64
        )
    """)
    .eq("campaign_id", value: campaignId.uuidString)
    .eq("building_id", value: building.id.uuidString)
    .eq("is_primary", value: true)
    .maybeSingle()
    .execute()
```

### Query 3: Get Residents/Contacts

```swift
// Once you have address.id
let contacts = try await supabase
    .from("contacts")
    .select("id, full_name, phone, email, status, notes, created_at")
    .eq("address_id", value: addressId.uuidString)
    .order("created_at", ascending: false)
    .execute()
```

### Query 4: Get Building Stats (Optional - for additional metadata)

```swift
let stats = try await supabase
    .from("building_stats")
    .select("status, scans_total, scans_today, last_scan_at")
    .eq("gers_id", value: gersId.uuidString)
    .eq("campaign_id", value: campaignId.uuidString)
    .maybeSingle()
    .execute()
```

## 🎨 Building Color Logic

```swift
func getBuildingColor(status: String, scansTotal: Int, qrScanned: Bool?) -> UIColor {
    // Priority 1: QR Scanned (Yellow)
    if qrScanned == true || scansTotal > 0 {
        return UIColor(hex: "#FCD34D") // Yellow
    }
    
    // Priority 2: Hot Lead (Blue)
    if status == "hot" {
        return UIColor(hex: "#3B82F6") // Blue
    }
    
    // Priority 3: Visited (Green)
    if status == "visited" {
        return UIColor(hex: "#10B981") // Green
    }
    
    // Priority 4: Not Visited (Red)
    return UIColor(hex: "#EF4444") // Red
}
```

## 📱 Minimal Working Example

```swift
import Supabase
import SwiftUI

struct QuickLocationCard: View {
    let gersId: UUID
    let campaignId: UUID
    
    @State private var addressText: String = ""
    @State private var residents: [String] = []
    @State private var scanCount: Int = 0
    @State private var isLoading = true
    
    var body: some View {
        VStack(alignment: .leading) {
            if isLoading {
                ProgressView()
            } else {
                Text(addressText).font(.headline)
                Text("\(residents.count) residents").font(.caption)
                Text("Scanned \(scanCount)x").font(.caption)
            }
        }
        .task {
            await loadData()
        }
    }
    
    func loadData() async {
        let supabase = SupabaseClient(
            supabaseURL: URL(string: "YOUR_URL")!,
            supabaseKey: "YOUR_KEY"
        )
        
        // 1. Get address
        let addressResponse = try? await supabase
            .from("campaign_addresses")
            .select("id, formatted, scans, house_number, street_name")
            .eq("campaign_id", value: campaignId.uuidString)
            .or("gers_id.eq.\(gersId.uuidString)")
            .maybeSingle()
            .execute()
        
        if let address = addressResponse?.value as? [String: Any],
           let addressId = address["id"] as? String,
           let formatted = address["formatted"] as? String {
            
            addressText = formatted
            scanCount = (address["scans"] as? Int) ?? 0
            
            // 2. Get contacts
            let contactsResponse = try? await supabase
                .from("contacts")
                .select("full_name")
                .eq("address_id", value: addressId)
                .execute()
            
            if let contacts = contactsResponse?.value as? [[String: Any]] {
                residents = contacts.compactMap { $0["full_name"] as? String }
            }
        }
        
        isLoading = false
    }
}
```

## 🔔 Real-time Updates

```swift
// Subscribe to building_stats changes
let channel = supabase
    .channel("building-stats-\(campaignId)")
    .on(
        .postgresChanges(
            event: .all,
            schema: "public",
            table: "building_stats"
        )
    ) { payload in
        if let new = payload.new as? [String: Any],
           let gersIdString = new["gers_id"] as? String,
           let gersId = UUID(uuidString: gersIdString),
           let status = new["status"] as? String,
           let scansTotal = new["scans_total"] as? Int {
            
            // Update building color on map
            updateBuildingColor(gersId: gersId, 
                               status: status, 
                               scansTotal: scansTotal)
        }
    }

await channel.subscribe()

// Don't forget to unsubscribe!
await channel.unsubscribe()
```

## 📋 Data Models

```swift
struct CampaignAddress: Codable {
    let id: UUID
    let houseNumber: String?
    let streetName: String?
    let formatted: String?
    let locality: String?
    let region: String?
    let postalCode: String?
    let gersId: UUID?
    let scans: Int?
    let lastScannedAt: Date?
    let qrCodeBase64: String?
    
    var displayAddress: String {
        if let house = houseNumber, let street = streetName {
            return "\(house) \(street)"
        }
        return formatted ?? "Unknown Address"
    }
}

struct Contact: Codable {
    let id: UUID
    let fullName: String
    let phone: String?
    let email: String?
    let status: String
    let notes: String?
}

struct BuildingStats: Codable {
    let gersId: UUID
    let status: String  // "not_visited", "visited", "hot"
    let scansTotal: Int
    let scansToday: Int
    let lastScanAt: Date?
}
```

## 🚨 Common Pitfalls

### ❌ Don't do this:
```swift
// Bad: Querying buildings table directly for address info
let building = supabase.from("map_buildings").select("*").eq("gers_id", ...)
// Building table doesn't have resident/contact info!
```

### ✅ Do this instead:
```swift
// Good: Use campaign_addresses as the bridge
let address = supabase.from("campaign_addresses").select("*").eq("gers_id", ...)
// Then fetch contacts using address.id
```

## 🎯 Testing Quick Checklist

1. **Normal Case**: GERS ID with address + contacts
   - Should show: Address, resident count, scan count
   
2. **No Residents**: GERS ID with address but no contacts
   - Should show: Address, "No residents", scan count
   
3. **No Link**: GERS ID with no address link
   - Should show: "Unlinked Building" message
   
4. **QR Scanned**: Building with scans > 0
   - Should show: Yellow color, "Scanned Nx"
   
5. **Real-time**: Scan QR code while viewing map
   - Should update: Building color → yellow, scan count increments

## 🔗 Key Relationships

```
GERS ID (map_buildings.gers_id)
    ↓
campaign_addresses.gers_id OR building_address_links
    ↓
campaign_addresses.id (addressId)
    ↓
contacts.address_id (residents)
    ↓
Display in UI
```

## 🏗️ Architecture Diagram

```
┌─────────────────┐
│   Map Tap       │
│   (GERS ID)     │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│  campaign_addresses      │  ← Primary lookup
│  WHERE gers_id = ?       │
└────────┬────────────────┘
         │ (if found)
         ▼
┌─────────────────────────┐
│  contacts                │
│  WHERE address_id = ?    │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│  LocationCard UI         │
│  • Address               │
│  • Residents             │
│  • QR Status             │
│  • Actions               │
└─────────────────────────┘
```

## 💡 Pro Tips

1. **Cache aggressively**: Building data rarely changes, cache for 5-10 minutes
2. **Batch queries**: If showing multiple buildings, batch the queries
3. **Optimistic UI**: Show last known data immediately, update in background
4. **Error states**: Always handle "no address found" gracefully
5. **Real-time**: Only subscribe when map is visible, unsubscribe on dismiss

## 📞 Quick Support

If you need to debug, check these in order:

1. Does `campaign_addresses` have a row with matching `gers_id`?
2. Does `building_address_links` connect the building to an address?
3. Does `contacts` have rows with the `address_id`?
4. Is `campaign_id` correctly passed through all queries?

Use this SQL to verify:

```sql
-- Check if address exists
SELECT * FROM campaign_addresses 
WHERE gers_id = 'YOUR_GERS_ID' 
AND campaign_id = 'YOUR_CAMPAIGN_ID';

-- Check if link exists  
SELECT * FROM building_address_links 
WHERE building_id IN (
  SELECT id FROM map_buildings WHERE gers_id = 'YOUR_GERS_ID'
)
AND campaign_id = 'YOUR_CAMPAIGN_ID';

-- Check contacts
SELECT * FROM contacts 
WHERE address_id = 'YOUR_ADDRESS_ID';
```
