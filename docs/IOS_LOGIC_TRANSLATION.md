# iOS Logic Translation Guide

## Direct TypeScript → Swift Translation

This document shows the exact web app logic alongside its Swift equivalent for easy porting.

---

## 1. Building Data Fetching Hook

### TypeScript (Web App)

```typescript
// lib/hooks/useBuildingData.ts
export function useBuildingData(
  gersId: string | null,
  campaignId: string | null
): BuildingData {
  const [isLoading, setIsLoading] = useState(false);
  const [address, setAddress] = useState<ResolvedAddress | null>(null);
  const [residents, setResidents] = useState<Contact[]>([]);
  const [qrStatus, setQrStatus] = useState<QrStatus>({
    hasFlyer: false,
    totalScans: 0,
    lastScannedAt: null,
  });

  const fetchData = useCallback(async () => {
    if (!gersId || !campaignId) return;
    
    setIsLoading(true);
    const supabase = createClient();

    // Step 1: Try direct address lookup
    const { data: addressData, error: addressError } = await supabase
      .from('campaign_addresses')
      .select(`
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
      `)
      .eq('campaign_id', campaignId)
      .or(`gers_id.eq.${gersId},building_gers_id.eq.${gersId}`)
      .maybeSingle();

    if (addressData) {
      // Step 2: Fetch contacts
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('*')
        .eq('address_id', addressData.id)
        .order('created_at', { ascending: false });

      setAddress({
        id: addressData.id,
        street: `${addressData.house_number || ''} ${addressData.street_name || ''}`.trim(),
        formatted: addressData.formatted,
        locality: addressData.locality || '',
        region: addressData.region || '',
        postalCode: addressData.postal_code || '',
        houseNumber: addressData.house_number || '',
        streetName: addressData.street_name || '',
        gersId: addressData.gers_id || gersId,
      });

      setResidents(contactsData || []);
      
      setQrStatus({
        hasFlyer: !!(addressData.qr_code_base64 || addressData.scans > 0),
        totalScans: addressData.scans || 0,
        lastScannedAt: addressData.last_scanned_at 
          ? new Date(addressData.last_scanned_at) 
          : null,
      });
    }
    
    setIsLoading(false);
  }, [gersId, campaignId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { isLoading, address, residents, qrStatus };
}
```

### Swift (iOS App)

```swift
// BuildingDataService.swift
class BuildingDataService: ObservableObject {
    @Published var isLoading = false
    @Published var address: ResolvedAddress?
    @Published var residents: [Contact] = []
    @Published var qrStatus = QRStatus(hasFlyer: false, totalScans: 0, lastScannedAt: nil)
    
    private let supabase: SupabaseClient
    
    init(supabase: SupabaseClient) {
        self.supabase = supabase
    }
    
    func fetchBuildingData(gersId: UUID, campaignId: UUID) async {
        guard !gersId.uuidString.isEmpty && !campaignId.uuidString.isEmpty else { return }
        
        await MainActor.run { isLoading = true }
        
        do {
            // Step 1: Try direct address lookup
            struct AddressResult: Codable {
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
                
                enum CodingKeys: String, CodingKey {
                    case id
                    case houseNumber = "house_number"
                    case streetName = "street_name"
                    case formatted, locality, region
                    case postalCode = "postal_code"
                    case gersId = "gers_id"
                    case scans
                    case lastScannedAt = "last_scanned_at"
                    case qrCodeBase64 = "qr_code_base64"
                }
            }
            
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
            
            let addressResult: AddressResult? = try await addressQuery.execute().value
            
            if let addressData = addressResult {
                // Step 2: Fetch contacts
                let contactsQuery = supabase
                    .from("contacts")
                    .select("*")
                    .eq("address_id", value: addressData.id.uuidString)
                    .order("created_at", ascending: false)
                
                let contactsResult: [Contact]? = try await contactsQuery.execute().value
                
                // Update UI on main thread
                await MainActor.run {
                    let house = addressData.houseNumber ?? ""
                    let street = addressData.streetName ?? ""
                    let combinedStreet = "\(house) \(street)".trimmingCharacters(in: .whitespaces)
                    
                    self.address = ResolvedAddress(
                        id: addressData.id,
                        street: combinedStreet,
                        formatted: addressData.formatted ?? combinedStreet,
                        locality: addressData.locality ?? "",
                        region: addressData.region ?? "",
                        postalCode: addressData.postalCode ?? "",
                        houseNumber: addressData.houseNumber ?? "",
                        streetName: addressData.streetName ?? "",
                        gersId: addressData.gersId ?? gersId
                    )
                    
                    self.residents = contactsResult ?? []
                    
                    self.qrStatus = QRStatus(
                        hasFlyer: addressData.qrCodeBase64 != nil || (addressData.scans ?? 0) > 0,
                        totalScans: addressData.scans ?? 0,
                        lastScannedAt: addressData.lastScannedAt
                    )
                }
            }
            
        } catch {
            print("Error fetching building data: \(error)")
        }
        
        await MainActor.run { isLoading = false }
    }
}
```

---

## 2. Building Color Expression

### TypeScript (Web App)

```typescript
// components/map/MapBuildingsLayer.tsx
const getColorExpression = (): any => {
  const getStatusValue = () => ['coalesce', ['feature-state', 'status'], ['get', 'status'], 'not_visited'];
  const getScansTotal = () => ['coalesce', ['feature-state', 'scans_total'], ['get', 'scans_total'], 0];
  const getQrScanned = () => ['coalesce', ['feature-state', 'qr_scanned'], ['get', 'qr_scanned'], false];
  
  return [
    'case',
    // QR_SCANNED (highest priority)
    ['any', ['==', getQrScanned(), true], ['>', getScansTotal(), 0]],
    '#FCD34D', // Yellow
    
    // CONVERSATIONS
    ['==', getStatusValue(), 'hot'],
    '#3B82F6', // Blue
    
    // TOUCHED
    ['==', getStatusValue(), 'visited'],
    '#10B981', // Green
    
    // UNTOUCHED (default)
    '#EF4444' // Red
  ];
};
```

### Swift (iOS App)

```swift
// BuildingColorManager.swift
enum BuildingStatus {
    case qrScanned
    case conversations
    case touched
    case untouched
    
    var color: UIColor {
        switch self {
        case .qrScanned: return UIColor(red: 0.988, green: 0.827, blue: 0.302, alpha: 1.0) // #FCD34D
        case .conversations: return UIColor(red: 0.231, green: 0.510, blue: 0.965, alpha: 1.0) // #3B82F6
        case .touched: return UIColor(red: 0.063, green: 0.725, blue: 0.506, alpha: 1.0) // #10B981
        case .untouched: return UIColor(red: 0.937, green: 0.267, blue: 0.267, alpha: 1.0) // #EF4444
        }
    }
}

struct BuildingFeatureProperties {
    let status: String
    let scansTotal: Int
    let qrScanned: Bool?
    
    func getEffectiveStatus() -> BuildingStatus {
        // Priority 1: QR Scanned
        if qrScanned == true || scansTotal > 0 {
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
    
    func getColor() -> UIColor {
        return getEffectiveStatus().color
    }
}
```

---

## 3. Real-time Subscription

### TypeScript (Web App)

```typescript
// components/map/MapBuildingsLayer.tsx
useEffect(() => {
  if (!map || !campaignId) return;

  const channel = supabase
    .channel(`building-stats-realtime-${campaignId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'building_stats',
      },
      (payload) => {
        if (payload.new) {
          const newProps = payload.new as any;
          const updatedGersId = newProps.gers_id;
          const newStatus = newProps.status;
          const scansTotal = newProps.scans_total || 0;
          
          // Update feature state for instant color change
          if (updatedGersId) {
            map.setFeatureState(
              { source: sourceId, id: updatedGersId },
              { 
                status: newStatus,
                scans_total: scansTotal,
                qr_scanned: scansTotal > 0,
              }
            );
          }
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [map, campaignId, supabase]);
```

### Swift (iOS App)

```swift
// BuildingStatsSubscriber.swift
class BuildingStatsSubscriber {
    private let supabase: SupabaseClient
    private var channel: RealtimeChannel?
    
    var onUpdate: ((UUID, String, Int, Bool) -> Void)?
    
    init(supabase: SupabaseClient) {
        self.supabase = supabase
    }
    
    func subscribe(campaignId: UUID) {
        let channelId = "building-stats-realtime-\(campaignId.uuidString)"
        
        channel = supabase
            .channel(channelId)
            .on(
                .postgresChanges(
                    event: .all,
                    schema: "public",
                    table: "building_stats"
                )
            ) { [weak self] payload in
                guard let self = self else { return }
                
                if let newData = payload.new as? [String: Any],
                   let gersIdString = newData["gers_id"] as? String,
                   let gersId = UUID(uuidString: gersIdString),
                   let status = newData["status"] as? String,
                   let scansTotal = newData["scans_total"] as? Int {
                    
                    let qrScanned = scansTotal > 0
                    
                    // Call update handler
                    self.onUpdate?(gersId, status, scansTotal, qrScanned)
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
        channel = nil
    }
}

// Usage in MapView
class MapViewController: UIViewController {
    private var statsSubscriber: BuildingStatsSubscriber?
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        statsSubscriber = BuildingStatsSubscriber(supabase: supabaseClient)
        statsSubscriber?.onUpdate = { [weak self] gersId, status, scansTotal, qrScanned in
            // Update building annotation color
            self?.updateBuildingColor(gersId: gersId, status: status, scansTotal: scansTotal, qrScanned: qrScanned)
        }
        
        if let campaignId = currentCampaignId {
            statsSubscriber?.subscribe(campaignId: campaignId)
        }
    }
    
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        statsSubscriber?.unsubscribe()
    }
    
    private func updateBuildingColor(gersId: UUID, status: String, scansTotal: Int, qrScanned: Bool) {
        // Find annotation
        guard let annotation = mapView.annotations
            .compactMap({ $0 as? BuildingAnnotation })
            .first(where: { $0.gersId == gersId }) else {
            return
        }
        
        // Update color based on new data
        let properties = BuildingFeatureProperties(
            status: status,
            scansTotal: scansTotal,
            qrScanned: qrScanned
        )
        
        let newColor = properties.getColor()
        
        // Update annotation view
        if let annotationView = mapView.view(for: annotation) as? BuildingAnnotationView {
            annotationView.markerTintColor = newColor
        }
    }
}
```

---

## 4. Location Card Component

### TypeScript (Web App)

```typescript
// components/map/LocationCard.tsx
export function LocationCard({
  gersId,
  campaignId,
  onClose,
  onNavigate,
  onLogVisit,
  onAddContact,
}: LocationCardProps) {
  const { isLoading, error, address, residents, qrStatus, addressLinked } = 
    useBuildingData(gersId, campaignId);

  const getResidentsText = (contacts: Contact[]): string => {
    if (contacts.length === 0) return 'No residents';
    if (contacts.length === 1) return contacts[0].full_name;
    return `${contacts[0].full_name} + ${contacts.length - 1} other${contacts.length > 2 ? 's' : ''}`;
  };

  const getStatusBadge = () => {
    if (qrStatus.totalScans > 0) {
      return { variant: 'default' as const, text: 'Scanned' };
    }
    if (qrStatus.hasFlyer) {
      return { variant: 'secondary' as const, text: 'Target' };
    }
    return { variant: 'outline' as const, text: 'New' };
  };

  if (isLoading) return <LoadingView />;
  if (error) return <ErrorView error={error} />;
  if (!addressLinked) return <UnlinkedView gersId={gersId} />;

  return (
    <div className="w-[320px] bg-white/95 backdrop-blur-xl rounded-2xl">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <h2>{address.street}</h2>
        <p>{address.locality}, {address.region}</p>
        <Badge>{getStatusBadge().text}</Badge>
      </div>

      {/* Residents Row */}
      <button onClick={() => residents.length > 0 ? onEdit() : onAddContact()}>
        <Users />
        <div>
          <p>{getResidentsText(residents)}</p>
          <p>{residents.length} resident{residents.length !== 1 ? 's' : ''}</p>
        </div>
      </button>

      {/* QR Status Row */}
      <div>
        <QrCode />
        <p>{qrStatus.hasFlyer 
          ? qrStatus.totalScans > 0 
            ? `Scanned ${qrStatus.totalScans}x` 
            : 'Flyer delivered'
          : 'No QR code'}
        </p>
      </div>

      {/* Actions */}
      <Button onClick={onNavigate}>Navigate</Button>
      <Button onClick={onLogVisit}>Log Visit</Button>
      <Button onClick={onAddContact}>Add</Button>
    </div>
  );
}
```

### Swift (iOS App)

```swift
// LocationCardView.swift
struct LocationCardView: View {
    let gersId: UUID
    let campaignId: UUID
    @StateObject private var dataService: BuildingDataService
    @Environment(\.dismiss) var dismiss
    
    var onNavigate: (() -> Void)?
    var onLogVisit: (() -> Void)?
    var onAddContact: ((UUID?, String?) -> Void)?
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if dataService.isLoading {
                loadingView
            } else if dataService.address == nil {
                unlinkedView
            } else if let address = dataService.address {
                mainContent(address: address)
            }
        }
        .frame(width: 320)
        .background(Color.white.opacity(0.95))
        .cornerRadius(16)
        .shadow(radius: 20)
        .task {
            await dataService.fetchBuildingData(gersId: gersId, campaignId: campaignId)
        }
    }
    
    private func mainContent(address: ResolvedAddress) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            VStack(alignment: .leading, spacing: 4) {
                Text(address.street)
                    .font(.headline)
                Text("\(address.locality), \(address.region)")
                    .font(.caption)
                    .foregroundColor(.gray)
                statusBadge
            }
            .padding()
            
            // Residents Row
            Button(action: {
                if dataService.residents.isEmpty {
                    onAddContact?(address.id, address.formatted)
                }
            }) {
                HStack(spacing: 12) {
                    Image(systemName: "person.2")
                        .foregroundColor(.blue)
                    VStack(alignment: .leading) {
                        Text(getResidentsText())
                            .fontWeight(.medium)
                        Text("\(dataService.residents.count) resident\(dataService.residents.count != 1 ? "s" : "")")
                            .font(.caption)
                    }
                }
                .padding()
            }
            
            // QR Status Row
            HStack(spacing: 12) {
                Image(systemName: "qrcode")
                    .foregroundColor(qrStatusColor)
                VStack(alignment: .leading) {
                    Text(qrStatusText)
                        .fontWeight(.medium)
                    Text(qrSubtext)
                        .font(.caption)
                }
            }
            .padding()
            
            // Actions
            HStack {
                if let onNavigate = onNavigate {
                    Button("Navigate", action: onNavigate)
                }
                if let onLogVisit = onLogVisit {
                    Button("Log Visit", action: onLogVisit)
                }
                if let onAddContact = onAddContact {
                    Button("Add") {
                        onAddContact(address.id, address.formatted)
                    }
                }
            }
            .padding()
        }
    }
    
    private func getResidentsText() -> String {
        let residents = dataService.residents
        if residents.isEmpty { return "No residents" }
        if residents.count == 1 { return residents[0].fullName }
        return "\(residents[0].fullName) + \(residents.count - 1) other\(residents.count > 2 ? "s" : "")"
    }
    
    private var statusBadge: some View {
        Text(dataService.qrStatus.totalScans > 0 ? "Scanned" : 
             dataService.qrStatus.hasFlyer ? "Target" : "New")
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.blue.opacity(0.1))
            .cornerRadius(4)
    }
    
    private var qrStatusText: String {
        let qr = dataService.qrStatus
        if qr.hasFlyer {
            return qr.totalScans > 0 ? "Scanned \(qr.totalScans)x" : "Flyer delivered"
        }
        return "No QR code"
    }
    
    private var qrSubtext: String {
        if let lastScanned = dataService.qrStatus.lastScannedAt {
            return "Last: \(lastScanned.formatted())"
        }
        return dataService.qrStatus.hasFlyer ? "Not scanned yet" : "Generate in campaign"
    }
    
    private var qrStatusColor: Color {
        let qr = dataService.qrStatus
        if qr.hasFlyer {
            return qr.totalScans > 0 ? .green : .orange
        }
        return .gray
    }
    
    private var loadingView: some View {
        ProgressView("Loading...")
            .padding()
    }
    
    private var unlinkedView: some View {
        VStack {
            Text("Unlinked Building")
                .font(.headline)
            Text("No address data found")
                .font(.caption)
            Button("Close") { dismiss() }
        }
        .padding()
    }
}
```

---

## 5. Data Models Comparison

### TypeScript (Web App)

```typescript
// types/database.ts
export interface ResolvedAddress {
  id: string;
  street: string;
  formatted: string;
  locality: string;
  region: string;
  postalCode: string;
  houseNumber: string;
  streetName: string;
  gersId: string;
}

export interface QrStatus {
  hasFlyer: boolean;
  totalScans: number;
  lastScannedAt: Date | null;
}

export interface Contact {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  notes: string | null;
}
```

### Swift (iOS App)

```swift
// Models.swift
struct ResolvedAddress: Codable, Identifiable {
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

struct QRStatus: Codable {
    let hasFlyer: Bool
    let totalScans: Int
    let lastScannedAt: Date?
}

struct Contact: Codable, Identifiable {
    let id: UUID
    let fullName: String
    let phone: String?
    let email: String?
    let status: String
    let notes: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case fullName = "full_name"
        case phone, email, status, notes
    }
}
```

---

## Key Translation Notes

1. **Async/Await**: TypeScript's `async/await` maps 1:1 to Swift's `async/await`
2. **Nullable Types**: TypeScript's `| null` = Swift's optional `?`
3. **State Management**: React's `useState` = SwiftUI's `@State` or `@Published`
4. **Effects**: React's `useEffect` = SwiftUI's `.task` or `.onAppear`
5. **Callbacks**: TypeScript functions = Swift closures
6. **JSON Parsing**: Both use automatic Codable/JSON parsing
7. **Real-time**: Supabase JS client = Supabase Swift client (almost identical API)

## Testing Equivalence

| Web (Jest/Testing Library) | iOS (XCTest) |
|---------------------------|--------------|
| `expect(value).toBe(...)` | `XCTAssertEqual(value, ...)` |
| `await userEvent.click(...)` | `app.buttons["..."].tap()` |
| `screen.getByText(...)` | `app.staticTexts["..."]` |
| Mock Supabase responses | Mock URLSession responses |
