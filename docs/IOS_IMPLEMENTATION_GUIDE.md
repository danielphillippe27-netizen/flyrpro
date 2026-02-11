# iOS Implementation Guide: Linked Homes & Building Stats Card

## Overview

This guide documents the complete logic for transferring the "linked homes" feature and building stats card to your iOS app. When a user taps on a building on the map, the app should display detailed information including address, residents, QR scan status, and interaction history.

## Architecture Overview

### Key Concepts

1. **GERS ID**: Global Entity Reference System ID - a unique identifier for buildings from Overture Maps (UUID v4 format)
2. **Building-Address Links**: The bridge between physical buildings (identified by GERS ID) and campaign addresses (business data)
3. **Real-time Updates**: Uses Supabase real-time subscriptions to update building colors when QR codes are scanned
4. **Multi-table Linking**: Data spans multiple tables that must be joined correctly

### Data Flow

```
Map Tap (GERS ID)
    ↓
Building-Address Link Resolution
    ↓
Address Data (campaign_addresses)
    ↓
Related Data Fetching:
    - Contacts (residents)
    - QR Status (scans, flyer status)
    - Building Stats (status, scan counts)
    - Interaction History
    ↓
Display in Stats Card UI
```

## Database Schema

### Core Tables

#### 1. `map_buildings`
Primary table for building geometries displayed on the map.

```sql
CREATE TABLE map_buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,              -- 'overture', 'manual', etc.
  gers_id UUID,                      -- Overture GERS ID (unique identifier)
  geom GEOMETRY(Polygon, 4326),      -- Building footprint
  centroid GEOMETRY(Point, 4326),    -- Generated column: building center
  height_m NUMERIC,                  -- Building height in meters
  levels INTEGER,                    -- Number of floors
  is_townhome_row BOOLEAN DEFAULT false,
  units_count INTEGER DEFAULT 1,
  address_id UUID,                   -- FK to campaign_addresses
  campaign_id UUID,                  -- FK to campaigns
  house_number TEXT,
  street_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2. `campaign_addresses`
Business data for addresses within campaigns.

```sql
CREATE TABLE campaign_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id),
  house_number TEXT,
  street_name TEXT,
  formatted TEXT,                    -- Full formatted address
  locality TEXT,                     -- City
  region TEXT,                       -- State/Province
  postal_code TEXT,
  gers_id UUID,                      -- Direct link to building GERS ID
  building_gers_id UUID,             -- Alternative GERS ID field
  qr_code_base64 TEXT,               -- Generated QR code image
  scans INTEGER DEFAULT 0,           -- Total scan count
  last_scanned_at TIMESTAMPTZ,      -- Most recent scan
  geom GEOMETRY(Point, 4326),        -- Address location
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3. `building_address_links`
The "stable linker" that connects buildings to addresses.

```sql
CREATE TABLE building_address_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID NOT NULL REFERENCES map_buildings(id),
  address_id UUID NOT NULL REFERENCES campaign_addresses(id),
  campaign_id UUID NOT NULL REFERENCES campaigns(id),
  match_method TEXT,                 -- 'COVERS', 'NEAREST', etc.
  is_primary BOOLEAN DEFAULT false,  -- Primary link for this building
  confidence_score NUMERIC,          -- Match confidence (0-1)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(building_id, address_id, campaign_id)
);
```

#### 4. `building_stats`
Real-time stats for buildings (updated by triggers).

```sql
CREATE TABLE building_stats (
  building_id UUID PRIMARY KEY REFERENCES map_buildings(id),
  campaign_id UUID REFERENCES campaigns(id),
  gers_id UUID,                      -- Denormalized for fast lookup
  status TEXT NOT NULL DEFAULT 'not_visited',  -- 'not_visited', 'visited', 'hot'
  scans_total INTEGER DEFAULT 0,
  scans_today INTEGER DEFAULT 0,
  last_scan_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 5. `contacts`
Resident/contact information linked to addresses.

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  campaign_id UUID REFERENCES campaigns(id),
  address_id UUID REFERENCES campaign_addresses(id),
  gers_id UUID,                      -- Direct GERS ID link
  full_name TEXT,
  phone TEXT,
  email TEXT,
  status TEXT,                       -- 'hot', 'warm', 'cold', 'new'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 6. `scan_events`
Individual QR code scan events.

```sql
CREATE TABLE scan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID REFERENCES map_buildings(id),
  campaign_id UUID REFERENCES campaigns(id),
  qr_code_id UUID REFERENCES qr_codes(id),
  address_id UUID REFERENCES campaign_addresses(id),
  scanned_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Core Data Fetching Logic

### Swift Implementation

#### 1. Building Data Hook (Swift equivalent of `useBuildingData`)

```swift
import Foundation
import Supabase

struct ResolvedAddress {
    let id: UUID
    let street: String
    let formatted: String
    let locality: String
    let region: String
    let postalCode: String
    let houseNumber: String
    let streetName: String
    let gersId: UUID
}

struct QRStatus {
    let hasFlyer: Bool
    let totalScans: Int
    let lastScannedAt: Date?
}

struct Contact {
    let id: UUID
    let fullName: String
    let phone: String?
    let email: String?
    let status: String
    let notes: String?
}

struct BuildingData {
    let isLoading: Bool
    let error: Error?
    let address: ResolvedAddress?
    let residents: [Contact]
    let qrStatus: QRStatus
    let buildingExists: Bool
    let addressLinked: Bool
}

class BuildingDataService: ObservableObject {
    @Published var buildingData: BuildingData = BuildingData(
        isLoading: false,
        error: nil,
        address: nil,
        residents: [],
        qrStatus: QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil),
        buildingExists: false,
        addressLinked: false
    )
    
    private let supabase: SupabaseClient
    
    init(supabase: SupabaseClient) {
        self.supabase = supabase
    }
    
    func fetchBuildingData(gersId: UUID, campaignId: UUID) async {
        await MainActor.run {
            buildingData = BuildingData(
                isLoading: true,
                error: nil,
                address: nil,
                residents: [],
                qrStatus: QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil),
                buildingExists: false,
                addressLinked: false
            )
        }
        
        do {
            // Step 1: Try direct address lookup by GERS ID
            let addressQuery = supabase
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
            
            let addressResponse: [CampaignAddress]? = try await addressQuery.execute().value
            var resolvedAddress = addressResponse?.first
            
            // Step 2: If no direct match, try via building_address_links
            if resolvedAddress == nil {
                // First find the building
                let buildingQuery = supabase
                    .from("map_buildings")
                    .select("id, gers_id")
                    .eq("gers_id", value: gersId.uuidString)
                
                let buildingResponse: [MapBuilding]? = try await buildingQuery.execute().value
                
                if let building = buildingResponse?.first {
                    await MainActor.run {
                        var current = buildingData
                        current.buildingExists = true
                        buildingData = current
                    }
                    
                    // Find linked address via building_address_links
                    let linkQuery = supabase
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
                    
                    let linkResponse: [BuildingAddressLink]? = try await linkQuery.execute().value
                    resolvedAddress = linkResponse?.first?.campaignAddress
                }
            } else {
                await MainActor.run {
                    var current = buildingData
                    current.buildingExists = true
                    buildingData = current
                }
            }
            
            // Step 3: Process resolved address
            if let address = resolvedAddress {
                let street = [address.houseNumber, address.streetName]
                    .compactMap { $0 }
                    .joined(separator: " ")
                
                let resolved = ResolvedAddress(
                    id: address.id,
                    street: !street.isEmpty ? street : address.formatted ?? "Unknown Address",
                    formatted: address.formatted ?? street,
                    locality: address.locality ?? "",
                    region: address.region ?? "",
                    postalCode: address.postalCode ?? "",
                    houseNumber: address.houseNumber ?? "",
                    streetName: address.streetName ?? "",
                    gersId: address.gersId ?? gersId
                )
                
                let qrStatus = QRStatus(
                    hasFlyer: address.qrCodeBase64 != nil || (address.scans ?? 0) > 0,
                    totalScans: address.scans ?? 0,
                    lastScannedAt: address.lastScannedAt
                )
                
                // Step 4: Fetch contacts linked to this address
                let contactsQuery = supabase
                    .from("contacts")
                    .select("*")
                    .eq("address_id", value: address.id.uuidString)
                    .order("created_at", ascending: false)
                
                let contactsResponse: [Contact]? = try await contactsQuery.execute().value
                
                await MainActor.run {
                    buildingData = BuildingData(
                        isLoading: false,
                        error: nil,
                        address: resolved,
                        residents: contactsResponse ?? [],
                        qrStatus: qrStatus,
                        buildingExists: true,
                        addressLinked: true
                    )
                }
            } else {
                await MainActor.run {
                    buildingData = BuildingData(
                        isLoading: false,
                        error: nil,
                        address: nil,
                        residents: [],
                        qrStatus: QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil),
                        buildingExists: buildingData.buildingExists,
                        addressLinked: false
                    )
                }
            }
        } catch {
            await MainActor.run {
                buildingData = BuildingData(
                    isLoading: false,
                    error: error,
                    address: nil,
                    residents: [],
                    qrStatus: QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil),
                    buildingExists: false,
                    addressLinked: false
                )
            }
        }
    }
}
```

#### 2. Location Card UI (SwiftUI)

```swift
import SwiftUI

struct LocationCardView: View {
    let gersId: UUID
    let campaignId: UUID
    @StateObject private var dataService: BuildingDataService
    @Environment(\.dismiss) var dismiss
    
    var onNavigate: (() -> Void)?
    var onLogVisit: (() -> Void)?
    var onAddContact: ((UUID?, String?) -> Void)?
    
    init(gersId: UUID, campaignId: UUID, supabase: SupabaseClient) {
        self.gersId = gersId
        self.campaignId = campaignId
        _dataService = StateObject(wrappedValue: BuildingDataService(supabase: supabase))
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Close button
            HStack {
                Spacer()
                Button(action: { dismiss() }) {
                    Image(systemName: "xmark")
                        .foregroundColor(.gray)
                        .padding(8)
                        .background(Color.gray.opacity(0.1))
                        .clipShape(Circle())
                }
                .padding()
            }
            
            if dataService.buildingData.isLoading {
                loadingView
            } else if let error = dataService.buildingData.error {
                errorView(error: error)
            } else if !dataService.buildingData.addressLinked {
                unlinkedBuildingView
            } else if let address = dataService.buildingData.address {
                mainContentView(address: address)
            }
        }
        .frame(width: 320)
        .background(Color.white)
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.2), radius: 20)
        .task {
            await dataService.fetchBuildingData(gersId: gersId, campaignId: campaignId)
        }
    }
    
    // MARK: - Loading State
    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Loading...")
                .foregroundColor(.gray)
        }
        .padding()
    }
    
    // MARK: - Error State
    private func errorView(error: Error) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundColor(.red)
                VStack(alignment: .leading) {
                    Text("Error loading data")
                        .fontWeight(.semibold)
                    Text(error.localizedDescription)
                        .font(.caption)
                        .foregroundColor(.red.opacity(0.8))
                }
            }
            Button("Close") {
                dismiss()
            }
            .frame(maxWidth: .infinity)
        }
        .padding()
    }
    
    // MARK: - Unlinked Building State
    private var unlinkedBuildingView: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "mappin.slash")
                    .foregroundColor(.gray)
                VStack(alignment: .leading) {
                    Text("Unlinked Building")
                        .fontWeight(.semibold)
                    Text("No address data found for this building")
                        .font(.caption)
                        .foregroundColor(.gray)
                }
            }
            
            Text("GERS: \(gersId.uuidString)")
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(.gray)
            
            HStack(spacing: 8) {
                Button("Close") {
                    dismiss()
                }
                .frame(maxWidth: .infinity)
                
                if onAddContact != nil {
                    Button(action: { onAddContact?(nil, nil) }) {
                        HStack {
                            Image(systemName: "person.badge.plus")
                            Text("Link")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding()
    }
    
    // MARK: - Main Content
    private func mainContentView(address: ResolvedAddress) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            VStack(alignment: .leading, spacing: 4) {
                Text(address.street)
                    .font(.headline)
                    .lineLimit(1)
                
                Text([address.locality, address.region, address.postalCode]
                    .filter { !$0.isEmpty }
                    .joined(separator: ", "))
                    .font(.caption)
                    .foregroundColor(.gray)
                
                statusBadge
            }
            .padding()
            
            // Content Rows
            VStack(spacing: 12) {
                residentsRow(address: address)
                
                if let firstNotes = dataService.buildingData.residents.first(where: { $0.notes != nil })?.notes {
                    notesSection(notes: firstNotes)
                }
                
                qrStatusRow
            }
            .padding(.horizontal)
            
            // Action Footer
            Divider()
                .padding(.top)
            
            HStack(spacing: 8) {
                if let onNavigate = onNavigate {
                    Button(action: onNavigate) {
                        HStack {
                            Image(systemName: "location")
                            Text("Navigate")
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                
                if let onLogVisit = onLogVisit {
                    Button(action: onLogVisit) {
                        HStack {
                            Image(systemName: "list.clipboard")
                            Text("Log Visit")
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                
                if let onAddContact = onAddContact {
                    Button(action: { onAddContact(address.id, address.formatted) }) {
                        HStack {
                            Image(systemName: "person.badge.plus")
                            Text("Add")
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding()
        }
    }
    
    private var statusBadge: some View {
        Text(getStatusText())
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(getStatusColor())
            .cornerRadius(4)
    }
    
    private func residentsRow(address: ResolvedAddress) -> some View {
        Button(action: {
            if let firstResident = dataService.buildingData.residents.first {
                // Handle edit contact
            } else if let onAddContact = onAddContact {
                onAddContact(address.id, address.formatted)
            }
        }) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(Color.blue.opacity(0.1))
                        .frame(width: 36, height: 36)
                    Image(systemName: "person.2")
                        .foregroundColor(.blue)
                }
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(getResidentsText())
                        .fontWeight(.medium)
                        .lineLimit(1)
                    
                    Text("\(dataService.buildingData.residents.count) resident\(dataService.buildingData.residents.count != 1 ? "s" : "")")
                        .font(.caption)
                        .foregroundColor(.gray)
                }
                
                Spacer()
                
                if dataService.buildingData.residents.isEmpty {
                    Image(systemName: "person.badge.plus")
                        .foregroundColor(.gray)
                }
            }
            .padding()
            .background(Color.gray.opacity(0.05))
            .cornerRadius(12)
        }
    }
    
    private func notesSection(notes: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Notes")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(.orange)
            Text(notes)
                .font(.caption)
        }
        .padding()
        .background(Color.orange.opacity(0.1))
        .cornerRadius(12)
    }
    
    private var qrStatusRow: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(getQRStatusColor().opacity(0.1))
                    .frame(width: 36, height: 36)
                Image(systemName: "qrcode")
                    .foregroundColor(getQRStatusColor())
            }
            
            VStack(alignment: .leading, spacing: 2) {
                Text(getQRStatusText())
                    .fontWeight(.medium)
                
                Text(getQRSubtext())
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            
            Spacer()
            
            if dataService.buildingData.qrStatus.totalScans > 0 {
                ZStack {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 24, height: 24)
                    Image(systemName: "checkmark")
                        .foregroundColor(.white)
                        .font(.caption)
                }
            }
        }
        .padding()
        .background(Color.gray.opacity(0.05))
        .cornerRadius(12)
    }
    
    // MARK: - Helper Methods
    private func getResidentsText() -> String {
        let residents = dataService.buildingData.residents
        if residents.isEmpty { return "No residents" }
        if residents.count == 1 { return residents[0].fullName }
        return "\(residents[0].fullName) + \(residents.count - 1) other\(residents.count > 2 ? "s" : "")"
    }
    
    private func getStatusText() -> String {
        let qrStatus = dataService.buildingData.qrStatus
        if qrStatus.totalScans > 0 { return "Scanned" }
        if qrStatus.hasFlyer { return "Target" }
        return "New"
    }
    
    private func getStatusColor() -> Color {
        let qrStatus = dataService.buildingData.qrStatus
        if qrStatus.totalScans > 0 { return .blue }
        if qrStatus.hasFlyer { return .gray.opacity(0.2) }
        return .gray.opacity(0.1)
    }
    
    private func getQRStatusColor() -> Color {
        let qrStatus = dataService.buildingData.qrStatus
        if qrStatus.hasFlyer {
            return qrStatus.totalScans > 0 ? .green : .orange
        }
        return .gray
    }
    
    private func getQRStatusText() -> String {
        let qrStatus = dataService.buildingData.qrStatus
        if qrStatus.hasFlyer {
            return qrStatus.totalScans > 0 ? "Scanned \(qrStatus.totalScans)x" : "Flyer delivered"
        }
        return "No QR code"
    }
    
    private func getQRSubtext() -> String {
        let qrStatus = dataService.buildingData.qrStatus
        if let lastScanned = qrStatus.lastScannedAt {
            let formatter = DateFormatter()
            formatter.dateStyle = .short
            return "Last: \(formatter.string(from: lastScanned))"
        }
        if qrStatus.hasFlyer { return "Not scanned yet" }
        return "Generate in campaign"
    }
}
```

## Map Building Colors (Status-Based Rendering)

### Color Priority System

Buildings are colored based on this priority hierarchy:

1. **QR_SCANNED** (Highest Priority): Yellow `#FCD34D`
   - When `scans_total > 0` OR `qr_scanned = true`
   
2. **CONVERSATIONS**: Blue `#3B82F6`
   - When `status = 'hot'` AND not QR scanned
   
3. **TOUCHED**: Green `#10B981`
   - When `status = 'visited'` AND not QR scanned
   
4. **UNTOUCHED** (Default): Red `#EF4444`
   - When `status = 'not_visited'`

### Swift Implementation for Map Styling

```swift
enum BuildingStatus: String {
    case qrScanned = "QR_SCANNED"
    case conversations = "CONVERSATIONS"
    case touched = "TOUCHED"
    case untouched = "UNTOUCHED"
    
    var color: UIColor {
        switch self {
        case .qrScanned: return UIColor(hex: "#FCD34D") // Yellow
        case .conversations: return UIColor(hex: "#3B82F6") // Blue
        case .touched: return UIColor(hex: "#10B981") // Green
        case .untouched: return UIColor(hex: "#EF4444") // Red
        }
    }
    
    var label: String {
        switch self {
        case .qrScanned: return "QR Scanned"
        case .conversations: return "Hot Lead"
        case .touched: return "Visited"
        case .untouched: return "Not Visited"
        }
    }
}

struct BuildingFeatureProperties: Codable {
    let id: UUID
    let gersId: UUID?
    let status: String
    let scansTotal: Int
    let qrScanned: Bool?
    let heightM: Double
    let featureStatus: String?
    let matchMethod: String?
    let addressText: String?
    
    func getEffectiveStatus() -> BuildingStatus {
        // Priority 1: QR Scanned
        if (qrScanned == true) || (scansTotal > 0) {
            return .qrScanned
        }
        
        // Priority 2: Conversations (hot)
        if status == "hot" {
            return .conversations
        }
        
        // Priority 3: Touched (visited)
        if status == "visited" {
            return .touched
        }
        
        // Priority 4: Untouched (default)
        return .untouched
    }
}
```

## Real-time Updates

### Subscribing to Building Stats Changes

```swift
import Supabase

class BuildingStatsSubscription {
    private let supabase: SupabaseClient
    private var channel: RealtimeChannel?
    
    init(supabase: SupabaseClient) {
        self.supabase = supabase
    }
    
    func subscribe(campaignId: UUID, onUpdate: @escaping (UUID, String, Int, Bool) -> Void) {
        channel = supabase
            .channel("building-stats-\(campaignId.uuidString)")
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
                    
                    let qrScanned = scansTotal > 0
                    onUpdate(gersId, status, scansTotal, qrScanned)
                }
            }
        
        Task {
            await channel?.subscribe()
        }
    }
    
    func unsubscribe() {
        Task {
            await channel?.unsubscribe()
        }
    }
}
```

### MapKit Integration Example

```swift
import MapKit

class BuildingAnnotation: NSObject, MKAnnotation {
    let coordinate: CLLocationCoordinate2D
    let gersId: UUID
    var status: BuildingStatus
    var title: String?
    var subtitle: String?
    
    init(coordinate: CLLocationCoordinate2D, gersId: UUID, status: BuildingStatus) {
        self.coordinate = coordinate
        self.gersId = gersId
        self.status = status
        super.init()
    }
}

class BuildingAnnotationView: MKAnnotationView {
    override var annotation: MKAnnotation? {
        didSet {
            guard let buildingAnnotation = annotation as? BuildingAnnotation else { return }
            updateAppearance(for: buildingAnnotation.status)
        }
    }
    
    private func updateAppearance(for status: BuildingStatus) {
        backgroundColor = status.color
        layer.cornerRadius = 5
        layer.borderWidth = 1
        layer.borderColor = UIColor.white.cgColor
    }
}
```

## RPC Functions

### 1. `rpc_get_campaign_full_features`

Fetches ALL buildings for a campaign with linked address data. Used for "fetch once, render forever" pattern.

```sql
-- Supabase call
supabase.rpc('rpc_get_campaign_full_features', {
  p_campaign_id: 'campaign-uuid'
})
```

**Returns**: GeoJSON FeatureCollection with BuildingFeature objects

### 2. `rpc_get_buildings_in_bbox`

Fetches buildings within a bounding box (for exploration mode without campaign).

```sql
-- Supabase call
supabase.rpc('rpc_get_buildings_in_bbox', {
  min_lon: -79.5,
  min_lat: 43.6,
  max_lon: -79.3,
  max_lat: 43.7
})
```

## Testing Checklist

### Data Fetching Tests

- [ ] Test with valid GERS ID + campaign ID
- [ ] Test with GERS ID that has no address link
- [ ] Test with GERS ID that has multiple residents
- [ ] Test with GERS ID that has QR code + scans
- [ ] Test with GERS ID that has QR code but no scans
- [ ] Test with GERS ID that has no QR code
- [ ] Test with invalid GERS ID (should show unlinked state)

### Real-time Update Tests

- [ ] Scan QR code, verify building color changes to yellow
- [ ] Add contact, verify resident list updates
- [ ] Update building status, verify color changes
- [ ] Test with multiple buildings updating simultaneously

### UI/UX Tests

- [ ] Tap building with full data (address, residents, scans)
- [ ] Tap building with no residents
- [ ] Tap building with no address link
- [ ] Verify all action buttons work (Navigate, Log Visit, Add Contact)
- [ ] Verify close button dismisses card
- [ ] Test loading state display
- [ ] Test error state display

## API Endpoints

### Key Supabase Queries

```swift
// 1. Fetch address by GERS ID
let address = try await supabase
    .from("campaign_addresses")
    .select("*")
    .eq("campaign_id", value: campaignId)
    .or("gers_id.eq.\(gersId),building_gers_id.eq.\(gersId)")
    .single()
    .execute()

// 2. Fetch building-address link
let link = try await supabase
    .from("building_address_links")
    .select("address_id, campaign_addresses(*)")
    .eq("building_id", value: buildingId)
    .eq("campaign_id", value: campaignId)
    .eq("is_primary", value: true)
    .single()
    .execute()

// 3. Fetch contacts for address
let contacts = try await supabase
    .from("contacts")
    .select("*")
    .eq("address_id", value: addressId)
    .order("created_at", ascending: false)
    .execute()

// 4. Fetch building stats
let stats = try await supabase
    .from("building_stats")
    .select("*")
    .eq("gers_id", value: gersId)
    .eq("campaign_id", value: campaignId)
    .single()
    .execute()
```

## Dependencies

### Required Swift Packages

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/supabase/supabase-swift.git", from: "1.0.0"),
    .package(url: "https://github.com/apple/swift-log.git", from: "1.0.0")
]
```

### Minimum iOS Version
- iOS 16.0+ (for SwiftUI Task modifier and modern MapKit)

## Performance Considerations

1. **Caching**: Cache building data for 5 minutes to reduce API calls
2. **Pagination**: If showing many buildings, paginate contact lists
3. **Debouncing**: Debounce map pan/zoom events before fetching buildings
4. **Real-time**: Unsubscribe from channels when view disappears
5. **Image Loading**: Lazy load QR code images if not immediately visible

## Error Handling

```swift
enum BuildingDataError: LocalizedError {
    case buildingNotFound
    case noAddressLinked
    case networkError(Error)
    case databaseError(String)
    
    var errorDescription: String? {
        switch self {
        case .buildingNotFound:
            return "Building not found"
        case .noAddressLinked:
            return "No address data linked to this building"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .databaseError(let message):
            return "Database error: \(message)"
        }
    }
}
```

## Summary

This implementation guide provides:

1. ✅ Complete database schema for all related tables
2. ✅ Swift service class for fetching building data
3. ✅ SwiftUI LocationCard UI component
4. ✅ Real-time subscription logic for live updates
5. ✅ MapKit integration for building annotations
6. ✅ Color priority system for building status visualization
7. ✅ Error handling patterns
8. ✅ Testing checklist
9. ✅ Performance optimization tips

The key insight is the **GERS ID → Building-Address Link → Address ID bridge**, which connects map buildings to business data (contacts, QR codes, stats).
