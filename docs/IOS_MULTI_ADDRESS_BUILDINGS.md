# iOS Guide: Multi-Address Buildings (Gold & Silver)

## What Changed

Migration `20260217500000_gold_dedup_multi_address` fixed the Gold path in
`rpc_get_campaign_full_features` so it now emits **one feature per building**
instead of one per address. A new `address_count` property tells iOS how many
addresses are inside the building before any second query is needed.

### Feature Properties Summary

| Property | Gold (multi) | Gold (single) | Silver | Fallback |
|---|---|---|---|---|
| `gers_id` | building UUID | building UUID | GERS string | address UUID |
| `address_id` | **null** | address UUID | address UUID | address UUID |
| `address_count` | `6` | `1` | _(absent)_ | `1` |
| `source` | `gold` | `gold` | `silver` | `address_point` |
| `building_id` | building UUID | building UUID | GERS string | _(absent)_ |

**Rule**: when `address_id` is null on tap, it is a multi-address Gold building.
Fetch all addresses, show the picker list first.

---

## Data Models

Add `addresses` (plural) and `preferredAddressId` to the existing models:

```swift
struct ResolvedAddress: Identifiable {
    let id: UUID                 // campaign_addresses.id
    let street: String
    let formatted: String
    let locality: String
    let region: String
    let postalCode: String
    let houseNumber: String
    let streetName: String
    let buildingId: String       // Gold UUID or Silver GERS string
    let source: String           // "gold" | "silver" | "address_point"
}

struct BuildingData {
    let isLoading: Bool
    let error: Error?
    /// Primary/selected address (first in list, or preferredAddressId if set)
    let address: ResolvedAddress?
    /// ALL addresses linked to this building (count > 1 = multi-address)
    let addresses: [ResolvedAddress]
    let residents: [Contact]
    let qrStatus: QRStatus
    let addressLinked: Bool

    var isMultiAddress: Bool { addresses.count > 1 }
}
```

---

## BuildingDataService — Full Multi-Address Fetch

This mirrors `useBuildingData.ts` exactly, handling Gold, Silver, and fallback.

```swift
import Foundation
import Supabase

class BuildingDataService: ObservableObject {
    @Published var data = BuildingData(
        isLoading: false, error: nil,
        address: nil, addresses: [],
        residents: [], qrStatus: QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil),
        addressLinked: false
    )

    private let supabase: SupabaseClient

    init(supabase: SupabaseClient) {
        self.supabase = supabase
    }

    // buildingId  = feature.properties.gers_id  (String — Gold UUID or Silver GERS string)
    // preferredId = feature.properties.address_id (nil for multi-address Gold buildings)
    func fetch(buildingId: String, campaignId: UUID, preferredAddressId: UUID? = nil) async {
        await setLoading()

        do {
            let supabase = self.supabase
            let campaignStr = campaignId.uuidString
            var addressIds: [String] = []
            var preferredRow: AddressRow? = nil

            // ── If we already know which address was tapped (unit slice, single address), load it first
            if let preferred = preferredAddressId {
                preferredRow = try? await supabase
                    .from("campaign_addresses")
                    .select("id, house_number, street_name, formatted, building_id")
                    .eq("id", value: preferred.uuidString)
                    .eq("campaign_id", value: campaignStr)
                    .single()
                    .execute()
                    .value
            }

            // ── STEP 1: Silver path — building_address_links (building_id = GERS string)
            let linkRows: [[String: String]] = (try? await supabase
                .from("building_address_links")
                .select("address_id")
                .eq("campaign_id", value: campaignStr)
                .eq("building_id", value: buildingId)
                .execute()
                .value) ?? []
            addressIds = linkRows.compactMap { $0["address_id"] }

            // ── STEP 2: Gold path — campaign_addresses.building_id (UUID)
            if addressIds.isEmpty {
                let goldRows: [[String: String]] = (try? await supabase
                    .from("campaign_addresses")
                    .select("id")
                    .eq("campaign_id", value: campaignStr)
                    .eq("building_id", value: buildingId)
                    .execute()
                    .value) ?? []
                addressIds = goldRows.compactMap { $0["id"] }
            }

            // ── STEP 3: Fallback — buildingId IS the campaign_addresses.id
            if addressIds.isEmpty {
                let direct: AddressRow? = try? await supabase
                    .from("campaign_addresses")
                    .select("id, house_number, street_name, formatted, building_id")
                    .eq("campaign_id", value: campaignStr)
                    .eq("id", value: buildingId)
                    .maybeSingle()
                    .execute()
                    .value
                if let d = direct { addressIds = [d.id.uuidString] }
            }

            guard !addressIds.isEmpty else {
                await setUnlinked()
                return
            }

            // ── Fetch full address rows for all IDs
            let allRows: [AddressRow] = (try? await supabase
                .from("campaign_addresses")
                .select("id, house_number, street_name, formatted, building_id")
                .eq("campaign_id", value: campaignStr)
                .in("id", values: addressIds)
                .execute()
                .value) ?? []

            guard !allRows.isEmpty else {
                await setUnlinked()
                return
            }

            // Preserve link order (first linked = first shown in list)
            let orderMap = Dictionary(uniqueKeysWithValues: addressIds.enumerated().map { ($1, $0) })
            let sorted = allRows.sorted { (orderMap[$0.id.uuidString] ?? 0) < (orderMap[$1.id.uuidString] ?? 0) }
            let resolved = sorted.map { ResolvedAddress(from: $0, buildingId: buildingId) }

            // Pick primary: preferredAddressId if it's in the list, else first
            let primary: ResolvedAddress
            if let preferred = preferredAddressId,
               let found = resolved.first(where: { $0.id == preferred }) {
                primary = found
            } else {
                primary = resolved[0]
            }

            // Fetch contacts for primary address only
            let contacts: [Contact] = (try? await supabase
                .from("contacts")
                .select("id, full_name, phone, email, status, notes")
                .eq("address_id", value: primary.id.uuidString)
                .order("created_at", ascending: false)
                .execute()
                .value) ?? []

            await MainActor.run {
                data = BuildingData(
                    isLoading: false, error: nil,
                    address: primary,
                    addresses: resolved,
                    residents: contacts,
                    qrStatus: QRStatus(
                        hasFlyer: primary.scans > 0,
                        totalScans: primary.scans,
                        lastScannedAt: nil
                    ),
                    addressLinked: true
                )
            }

        } catch {
            await MainActor.run {
                data = BuildingData(
                    isLoading: false, error: error,
                    address: nil, addresses: [],
                    residents: [],
                    qrStatus: QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil),
                    addressLinked: false
                )
            }
        }
    }

    // Called when user picks an address from the list
    func selectAddress(_ addressId: UUID, campaignId: UUID, buildingId: String) async {
        guard let found = data.addresses.first(where: { $0.id == addressId }) else { return }

        let contacts: [Contact] = (try? await supabase
            .from("contacts")
            .select("id, full_name, phone, email, status, notes")
            .eq("address_id", value: addressId.uuidString)
            .order("created_at", ascending: false)
            .execute()
            .value) ?? []

        await MainActor.run {
            data = BuildingData(
                isLoading: false, error: nil,
                address: found,
                addresses: data.addresses,   // keep full list for "Back"
                residents: contacts,
                qrStatus: QRStatus(
                    hasFlyer: found.scans > 0,
                    totalScans: found.scans,
                    lastScannedAt: nil
                ),
                addressLinked: true
            )
        }
    }

    func clearSelection() async {
        // Reset to list mode: keep addresses but clear selected address
        await MainActor.run {
            data = BuildingData(
                isLoading: false, error: nil,
                address: data.addresses.first,
                addresses: data.addresses,
                residents: [],
                qrStatus: QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil),
                addressLinked: true
            )
        }
    }

    // MARK: - Helpers
    private func setLoading() async {
        await MainActor.run {
            data = BuildingData(
                isLoading: true, error: nil,
                address: nil, addresses: [],
                residents: [],
                qrStatus: QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil),
                addressLinked: false
            )
        }
    }

    private func setUnlinked() async {
        await MainActor.run {
            data = BuildingData(
                isLoading: false, error: nil,
                address: nil, addresses: [],
                residents: [],
                qrStatus: QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil),
                addressLinked: false
            )
        }
    }
}

// MARK: - Raw DB row (matches SELECT columns)
struct AddressRow: Codable {
    let id: UUID
    let houseNumber: String?
    let streetName: String?
    let formatted: String?
    let buildingId: String?  // UUID (Gold) or TEXT (Silver GERS)
    var scans: Int = 0
}

extension ResolvedAddress {
    init(from row: AddressRow, buildingId: String) {
        let street = [row.houseNumber, row.streetName].compactMap { $0 }.joined(separator: " ")
        self.id = row.id
        self.street = !street.isEmpty ? street : row.formatted ?? "Unknown Address"
        self.formatted = row.formatted ?? street
        self.locality = ""
        self.region = ""
        self.postalCode = ""
        self.houseNumber = row.houseNumber ?? ""
        self.streetName = row.streetName ?? ""
        self.buildingId = buildingId
        self.source = row.buildingId != nil ? "gold" : "silver"
    }
}
```

---

## LocationCardView — Multi-Address Aware SwiftUI

```swift
import SwiftUI

struct LocationCardView: View {
    let buildingId: String       // gers_id from map feature (string, not UUID)
    let campaignId: UUID
    let preferredAddressId: UUID?  // nil for multi-address Gold buildings

    @StateObject private var service: BuildingDataService
    @State private var selectedAddressId: UUID? = nil
    @Environment(\.dismiss) var dismiss

    var onNavigate: (() -> Void)?
    var onLogVisit: (() -> Void)?
    var onAddContact: ((UUID?, String?) -> Void)?

    // List mode: multi-address building AND no address selected yet
    private var isListMode: Bool {
        service.data.isMultiAddress && selectedAddressId == nil
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 0) {
                if service.data.isLoading {
                    loadingView
                } else if let error = service.data.error {
                    errorView(error)
                } else if !service.data.addressLinked {
                    unlinkedView
                } else {
                    if isListMode {
                        addressListView   // ← multi-address picker
                    } else if let address = service.data.address {
                        detailView(address)  // ← single address detail
                    }
                }
            }

            // Close button
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .padding(8)
                    .background(Color(.systemGray5))
                    .clipShape(Circle())
            }
            .padding(12)
        }
        .frame(width: 320)
        .background(.ultraThinMaterial)
        .cornerRadius(20)
        .shadow(color: .black.opacity(0.18), radius: 20, x: 0, y: 8)
        .task {
            await service.fetch(
                buildingId: buildingId,
                campaignId: campaignId,
                preferredAddressId: preferredAddressId
            )
            // If a specific address was passed in (unit tap), select it immediately
            selectedAddressId = preferredAddressId
        }
    }

    // MARK: - Address List (multi-address mode)
    private var addressListView: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(service.data.addresses.count) addresses")
                    .font(.title3).fontWeight(.semibold)
                    .padding(.trailing, 32) // avoid close button overlap
                Text("Tap an address for details")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            .padding(.top)

            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(service.data.addresses) { address in
                        Button {
                            selectedAddressId = address.id
                            Task {
                                await service.selectAddress(
                                    address.id,
                                    campaignId: campaignId,
                                    buildingId: buildingId
                                )
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "mappin")
                                    .foregroundStyle(.secondary)
                                    .frame(width: 16)
                                Text(address.formatted)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(Color(.systemGray6))
                            .cornerRadius(10)
                            .padding(.horizontal)
                        }
                    }
                }
            }
            .frame(maxHeight: 260)
            .padding(.bottom)
        }
    }

    // MARK: - Single Address Detail
    private func detailView(_ address: ResolvedAddress) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            VStack(alignment: .leading, spacing: 6) {
                // "Back to list" — only shown when coming from list mode
                if service.data.isMultiAddress {
                    Button {
                        selectedAddressId = nil
                        Task { await service.clearSelection() }
                    } label: {
                        Label("Back to list", systemImage: "chevron.left")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(address.formatted)
                            .font(.headline).lineLimit(1)
                            .padding(.trailing, 32)
                        Text(service.data.isMultiAddress
                             ? "\(service.data.addresses.count) addresses at this building"
                             : [address.locality, address.region, address.postalCode]
                                 .filter { !$0.isEmpty }.joined(separator: ", "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    statusBadge
                }
            }
            .padding()

            // Rows
            VStack(spacing: 8) {
                residentsRow(address: address)
                qrStatusRow
            }
            .padding(.horizontal)
            .padding(.bottom, 8)

            // Actions
            Divider()
            HStack(spacing: 8) {
                if let onNavigate {
                    ActionButton("Navigate", icon: "location", action: onNavigate)
                }
                if let onLogVisit {
                    ActionButton("Log Visit", icon: "list.clipboard", action: onLogVisit)
                }
                if let onAddContact {
                    ActionButton("Add", icon: "person.badge.plus", primary: true) {
                        onAddContact(address.id, address.formatted)
                    }
                }
            }
            .padding()
        }
    }

    // MARK: - Status Badge
    private var statusBadge: some View {
        let qr = service.data.qrStatus
        let text = qr.totalScans > 0 ? "Scanned" : qr.hasFlyer ? "Target" : "New"
        let color: Color = qr.totalScans > 0 ? .blue : .gray.opacity(0.2)
        return Text(text)
            .font(.caption2).fontWeight(.semibold)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(color)
            .cornerRadius(6)
    }

    // MARK: - Residents Row
    private func residentsRow(_ address: ResolvedAddress) -> some View {
        Button {
            if service.data.residents.isEmpty {
                onAddContact?(address.id, address.formatted)
            }
            // else: open edit contact sheet
        } label: {
            HStack(spacing: 12) {
                Circle().fill(Color.red.opacity(0.12)).frame(width: 36, height: 36)
                    .overlay(Image(systemName: "person.2").foregroundStyle(.red))
                VStack(alignment: .leading, spacing: 2) {
                    Text(residentsText).font(.subheadline).fontWeight(.medium).lineLimit(1)
                    Text(service.data.residents.isEmpty ? "Add a resident"
                         : "\(service.data.residents.count) resident\(service.data.residents.count != 1 ? "s" : "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if service.data.residents.isEmpty {
                    Image(systemName: "person.badge.plus").foregroundStyle(.secondary)
                }
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }

    // MARK: - QR Row
    private var qrStatusRow: some View {
        let qr = service.data.qrStatus
        let iconColor: Color = qr.hasFlyer ? (qr.totalScans > 0 ? .green : .orange) : .gray
        let title = qr.hasFlyer
            ? (qr.totalScans > 0 ? "Scanned \(qr.totalScans)x" : "Flyer delivered")
            : "No QR code"
        let subtitle = qr.lastScannedAt.map { "Last: \($0.formatted(date: .abbreviated, time: .omitted))" }
            ?? (qr.hasFlyer ? "Not scanned yet" : "Generate in campaign")

        return HStack(spacing: 12) {
            Circle().fill(iconColor.opacity(0.12)).frame(width: 36, height: 36)
                .overlay(Image(systemName: "qrcode").foregroundStyle(iconColor))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline).fontWeight(.medium)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if qr.totalScans > 0 {
                Circle().fill(Color.green).frame(width: 22, height: 22)
                    .overlay(Image(systemName: "checkmark").font(.caption2).foregroundStyle(.white))
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    // MARK: - Helpers
    private var residentsText: String {
        let r = service.data.residents
        if r.isEmpty { return "No residents" }
        if r.count == 1 { return r[0].fullName }
        return "\(r[0].fullName) + \(r.count - 1) other\(r.count > 2 ? "s" : "")"
    }

    // MARK: - State Views
    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("Loading…").foregroundStyle(.secondary)
        }
        .padding(40)
    }

    private func errorView(_ error: Error) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
            VStack(alignment: .leading) {
                Text("Error loading data").fontWeight(.semibold)
                Text(error.localizedDescription).font(.caption).foregroundStyle(.red)
            }
        }
        .padding()
    }

    private var unlinkedView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "mappin.slash").foregroundStyle(.secondary)
                VStack(alignment: .leading) {
                    Text("Unlinked Building").fontWeight(.semibold)
                    Text("No address data found").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text(buildingId).font(.system(.caption2, design: .monospaced)).foregroundStyle(.tertiary)
        }
        .padding()
    }
}

// MARK: - Reusable Action Button
private struct ActionButton: View {
    let label: String
    let icon: String
    var primary = false
    let action: () -> Void

    init(_ label: String, icon: String, primary: Bool = false, action: @escaping () -> Void) {
        self.label = label; self.icon = icon; self.primary = primary; self.action = action
    }

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: icon)
                .font(.caption).fontWeight(.medium)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(primary ? Color.accentColor : Color(.systemGray5))
                .foregroundStyle(primary ? .white : .primary)
                .cornerRadius(10)
        }
    }
}
```

---

## Map Tap Handler

```swift
// In your Mapbox / MapKit tap handler:
func handleBuildingTap(feature: MapFeature) {
    let buildingId = feature.properties["gers_id"] as? String
                  ?? feature.properties["id"] as? String
                  ?? ""

    // address_id is nil for multi-address Gold buildings (new behaviour)
    let addressId = (feature.properties["address_id"] as? String)
                        .flatMap { UUID(uuidString: $0) }

    // address_count > 1 means the picker list will be shown automatically
    // (no special handling needed — LocationCardView detects it from the data)
    showLocationCard(buildingId: buildingId, preferredAddressId: addressId)
}

func showLocationCard(buildingId: String, preferredAddressId: UUID?) {
    // Present LocationCardView as sheet / overlay
    let card = LocationCardView(
        buildingId: buildingId,
        campaignId: currentCampaignId,
        preferredAddressId: preferredAddressId,
        onNavigate: { /* open Maps */ },
        onLogVisit: { /* log visit sheet */ },
        onAddContact: { id, text in /* open add contact */ }
    )
    present(card)
}
```

---

## Flow Diagram

```
User taps building on map
        │
        ▼
  feature.properties
  ┌─────────────────────────────────────┐
  │ gers_id      = "bld-uuid-or-string" │
  │ address_id   = null  ← multi-addr   │  ← Gold multi-address
  │               or "uuid" ← single    │  ← Gold single / Silver
  │ address_count = 6                   │
  │ source       = "gold" | "silver"    │
  └─────────────────────────────────────┘
        │
        ▼
  LocationCardView.task { fetch(...) }
        │
        ├─ Silver: building_address_links WHERE building_id = gersIdString
        ├─ Gold:   campaign_addresses    WHERE building_id = buildingUUID
        └─ Fallback: campaign_addresses  WHERE id = gersId
        │
        ▼
  addresses.count == 1?
  ┌─────────────┬──────────────────────┐
  │     YES     │         NO           │
  │  Skip list  │  Show address list   │
  │  Show detail│  "6 addresses"       │
  └─────────────┴──────────────────────┘
                       │ user taps one
                       ▼
              service.selectAddress()
              → fetch contacts for that address
              → Show detail with "Back to list" button
```

---

## Gold vs Silver Identifier Format

| Source | `building_id` / `gers_id` type | Example |
|---|---|---|
| Gold (`ref_buildings_gold`) | UUID string | `"550e8400-e29b-41d4-a716-446655440000"` |
| Silver (`buildings` table) | GERS ID string | `"overture:building:abc123"` |
| Fallback (address point) | `campaign_addresses.id` UUID | `"a1b2c3d4-..."` |

**Important**: always pass `building_id` / `gers_id` as a `String` to the service —
never cast to `UUID`. The Silver path stores it as plain TEXT in `building_address_links.building_id`.

---

## Testing Checklist

### Gold — Multi-Address (Townhouse)
- [ ] Tap building → see "N addresses" list, NOT a single address card
- [ ] Tap an address from the list → see detail card with residents + QR
- [ ] "Back to list" button returns to address picker
- [ ] Each address in list has correct residents (not shared)

### Gold — Single Address
- [ ] Tap building → skip list, show detail directly
- [ ] Address, residents, QR status all correct

### Silver — Multi-Address
- [ ] Same list behaviour as Gold multi-address
- [ ] `building_address_links` has multiple rows for same `building_id`

### Silver — Single Address
- [ ] Shows detail directly (no list)

### Edge Cases
- [ ] Building with no links → "Unlinked Building" state
- [ ] `address_id` in feature props (unit slice tap) → skip list, go direct to that unit
- [ ] Fallback address point (no polygon) → tap shows single address card
